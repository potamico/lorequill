import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, sep } from "node:path";
import { checkRepository, formatSarif } from "@lorequill/checks";
import type { Diagnostic } from "vscode-languageserver";
import { URI } from "vscode-uri";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FolderChecker, type FolderCheckSummary, type OpenDocument } from "../../src";

const PROFILE = `version: 1
content:
  root: docs
  include: ["**/*.md"]
checks:
  rules:
    - { id: links, rule: relative-links }
`;

class FakeHost {
  documents = new Map<string, OpenDocument>();
  published = new Map<string, { diagnostics: Diagnostic[]; version?: number }>();
  statuses: FolderCheckSummary[] = [];
  openDocuments = (): OpenDocument[] => [...this.documents.values()];
  documentVersion = (uri: string): number | undefined => this.documents.get(uri)?.version;
  publish = (uri: string, diagnostics: Diagnostic[], version?: number): void => {
    this.published.set(uri, { diagnostics, ...(version === undefined ? {} : { version }) });
  };
  status = (summary: FolderCheckSummary): void => {
    this.statuses.push(summary);
  };
}

let base: string;
let host: FakeHost;

async function write(path: string, text: string): Promise<void> {
  await mkdir(dirname(join(base, path)), { recursive: true });
  await writeFile(join(base, path), text);
}

const uriOf = (path: string): string => URI.file(join(base, path)).toString();

beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), "lorequill-server-"));
  host = new FakeHost();
  await write(".lorequill/config.yaml", PROFILE);
  await write("docs/index.md", "# Start\n\n[setup](setup.md)\n");
});

afterEach(async () => {
  await rm(base, { recursive: true, force: true });
});

describe("FolderChecker", () => {
  it("publishes diagnostics with ranges, rule id, and localization data", async () => {
    const checker = new FolderChecker(URI.file(base).toString(), host);
    await checker.reload();
    const summary = await checker.checkNow();
    expect(summary).toMatchObject({ status: "failed", findings: 1, pagesChecked: 1 });
    const [diagnostic] = host.published.get(uriOf("docs/index.md"))?.diagnostics ?? [];
    expect(diagnostic).toMatchObject({
      range: { start: { line: 2, character: 0 }, end: { line: 2, character: 17 } },
      severity: 1,
      source: "Lorequill",
      code: "links",
      data: { code: "relative-links/missing-target", params: { target: "docs/setup.md" } },
    });
    expect(host.statuses.at(-1)?.status).toBe("failed");
    checker.dispose();
  });

  it("checks unsaved buffers and clears diagnostics that disappear", async () => {
    const checker = new FolderChecker(URI.file(base).toString(), host);
    await checker.reload();
    await checker.checkNow();
    host.documents.set(uriOf("docs/setup.md"), {
      uri: uriOf("docs/setup.md"),
      version: 3,
      text: "# Setup\n",
    });
    const summary = await checker.checkNow();
    expect(summary.status).toBe("passed");
    expect(host.published.get(uriOf("docs/index.md"))?.diagnostics).toEqual([]);
    checker.dispose();
  });

  it("tags diagnostics of open documents with their version", async () => {
    const uri = uriOf("docs/index.md");
    host.documents.set(uri, { uri, version: 7, text: "[x](gone.md)\n" });
    const checker = new FolderChecker(URI.file(base).toString(), host);
    await checker.reload();
    await checker.checkNow();
    expect(host.published.get(uri)?.version).toBe(7);
    checker.dispose();
  });

  it("discards results computed from an outdated document version", async () => {
    const uri = uriOf("docs/index.md");
    host.documents.set(uri, { uri, version: 1, text: "[x](gone.md)\n" });
    const checker = new FolderChecker(URI.file(base).toString(), host, 10_000);
    await checker.reload();
    const originalVersion = host.documentVersion;
    host.documentVersion = () => 2;
    await checker.checkNow();
    expect(host.published.has(uri)).toBe(false);
    host.documentVersion = originalVersion;
    checker.dispose();
  });

  it("reports an unavailable folder without a profile and publishes nothing", async () => {
    await rm(join(base, ".lorequill"), { recursive: true });
    const checker = new FolderChecker(URI.file(base).toString(), host);
    await checker.reload();
    expect(await checker.checkNow()).toMatchObject({ status: "unavailable", findings: 0 });
    expect(host.published.size).toBe(0);
    checker.dispose();
  });

  it("clears its diagnostics when the profile becomes invalid", async () => {
    const checker = new FolderChecker(URI.file(base).toString(), host);
    await checker.reload();
    await checker.checkNow();
    expect(host.published.get(uriOf("docs/index.md"))?.diagnostics).toHaveLength(1);
    await write(".lorequill/config.yaml", "version: 1\nbogus: true\n");
    await checker.reload();
    expect(host.published.get(uriOf("docs/index.md"))?.diagnostics).toEqual([]);
    checker.dispose();
  });

  it("knows which files belong to its folder", () => {
    const checker = new FolderChecker(URI.file(base).toString(), host);
    expect(checker.contains(join(base, "docs", "a.md"))).toBe(true);
    expect(checker.contains(join(base, "..", "other", "a.md"))).toBe(false);
    expect(checker.contains(base)).toBe(false);
    checker.dispose();
  });
});

describe("one engine in editor, CLI, and CI (AT 20)", () => {
  it("reports identical findings for identical files, profile, and engine version", async () => {
    await write(
      ".lorequill/config.yaml",
      `${PROFILE}    - { id: wikilinks, rule: forbidden-text, text: "[[" }
    - { id: ids, rule: unique-field, field: id }
`,
    );
    await write("docs/index.md", "---\nid: same\n---\n# Start\n\n[[wiki]] and [gone](gone.md#x)\n");
    await write("docs/b/other.md", "---\nid: same\n---\n# Other\n\n[up](../index.md#start)\n");

    // The editor: the language server's diagnostics.
    const checker = new FolderChecker(URI.file(base).toString(), host);
    await checker.reload();
    await checker.checkNow();
    const editor = [...host.published.entries()]
      .flatMap(([uri, { diagnostics }]) =>
        diagnostics.map((diagnostic) => {
          const data = diagnostic.data as { code: string };
          const path = URI.parse(uri)
            .fsPath.slice(base.length + 1)
            .split(sep)
            .join("/");
          return `${path}:${String(diagnostic.range.start.line + 1)}:${String(diagnostic.range.start.character + 1)} ${String(diagnostic.code)} ${data.code}`;
        }),
      )
      .sort();
    checker.dispose();

    // The CLI and the Action: the repository check, and the SARIF that CI uploads.
    const checked = await checkRepository(base);
    expect(checked.kind).toBe("checked");
    if (checked.kind !== "checked") {
      return;
    }
    const cli = checked.result.findings
      .map(
        (finding) =>
          `${finding.path}:${String(finding.line)}:${String(finding.column ?? 1)} ${finding.ruleId} ${finding.code}`,
      )
      .sort();
    const sarif = JSON.parse(formatSarif(checked.result, checked.profile)) as {
      runs: {
        results: {
          ruleId: string;
          locations: {
            physicalLocation: {
              artifactLocation: { uri: string };
              region: { startLine: number; startColumn?: number };
            };
          }[];
        }[];
      }[];
    };
    const ci = (sarif.runs[0]?.results ?? [])
      .map(({ ruleId, locations: [location] }) => {
        const physical = location?.physicalLocation;
        return `${decodeURIComponent(physical?.artifactLocation.uri ?? "")}:${String(physical?.region.startLine)}:${String(physical?.region.startColumn ?? 1)} ${ruleId}`;
      })
      .sort();

    expect(editor.length).toBeGreaterThanOrEqual(3);
    expect(editor).toEqual(cli);
    expect(ci).toEqual(cli.map((line) => line.slice(0, line.lastIndexOf(" "))));
  });
});
