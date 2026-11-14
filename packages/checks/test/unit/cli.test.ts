import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { build } from "esbuild";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ENGINE_VERSION } from "../../src";

const run = promisify(execFile);
let base: string;
let cli: string;

async function writeRepository(name: string, files: Record<string, string>): Promise<string> {
  const root = join(base, name);
  for (const [path, text] of Object.entries(files)) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), text);
  }
  return root;
}

const PROFILE = `version: 1
content:
  root: docs
  include: ["**/*.md"]
checks:
  rules:
    - { id: links, rule: relative-links }
    - { id: wikilinks, rule: forbidden-text, text: "[[" }
`;

interface CliRun {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

async function cliRun(...args: string[]): Promise<CliRun> {
  try {
    const { stdout, stderr } = await run(process.execPath, [cli, ...args], { encoding: "utf8" });
    return { code: 0, stdout, stderr };
  } catch (error) {
    const failed = error as { code: number; stdout: string; stderr: string };
    return { code: failed.code, stdout: failed.stdout, stderr: failed.stderr };
  }
}

beforeAll(async () => {
  base = await mkdtemp(join(tmpdir(), "lorequill-cli-"));
  cli = join(base, "cli.cjs");
  await build({
    entryPoints: [resolve(import.meta.dirname, "../../src/bin.ts")],
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node22",
    outfile: cli,
    logLevel: "silent",
  });
  await writeRepository("clean", {
    ".lorequill/config.yaml": PROFILE,
    "docs/index.md": "# Start\n\n[Setup](guides/setup.md)\n",
    "docs/guides/setup.md": "# Setup\n",
  });
  await writeRepository("broken", {
    ".lorequill/config.yaml": PROFILE,
    "docs/index.md": "[[wiki]] and [gone](gone.md)\n",
  });
  await writeRepository("invalid-profile", { ".lorequill/config.yaml": "version: 2\n" });
  await writeRepository("no-content", { ".lorequill/config.yaml": PROFILE });
}, 60_000);

afterAll(async () => {
  await rm(base, { recursive: true, force: true });
});

describe("lorequill-checks CLI", () => {
  it("exits 0 without findings and prints the engine version", async () => {
    const result = await cliRun(join(base, "clean"));
    expect(result.code).toBe(0);
    expect(result.stdout).toContain(
      `Lorequill checks ${ENGINE_VERSION}: 2 pages, 0 findings, passed`,
    );
  });

  it("exits 1 with findings in file:line:column format", async () => {
    const result = await cliRun(join(base, "broken"));
    expect(result.code).toBe(1);
    expect(result.stdout).toContain(
      'docs/index.md:1:1: error wikilinks: Forbidden text "[[" found. [forbidden-text/found]',
    );
    expect(result.stdout).toContain(
      'docs/index.md:1:14: error links: Link target "docs/gone.md" does not exist.',
    );
  });

  it("exits 2 for an invalid profile or a missing content root", async () => {
    const invalid = await cliRun(join(base, "invalid-profile"));
    expect(invalid.code).toBe(2);
    expect(invalid.stderr).toContain("cannot be used");
    const noContent = await cliRun(join(base, "no-content"));
    expect(noContent.code).toBe(2);
    expect(noContent.stderr).toContain('content.root "docs" is not a directory');
  });

  it("exits 2 for unknown options and formats", async () => {
    expect((await cliRun("--nope")).code).toBe(2);
    expect((await cliRun("--format", "xml", join(base, "clean"))).code).toBe(2);
  });

  it("prints the version and help", async () => {
    expect((await cliRun("--version")).stdout).toBe(`${ENGINE_VERSION}\n`);
    expect((await cliRun("--help")).stdout).toContain("Exit codes: 0 no findings");
  });

  it("writes JSON and SARIF reports", async () => {
    const output = join(base, "report.sarif");
    const sarifRun = await cliRun("--format", "sarif", "--output", output, join(base, "broken"));
    expect(sarifRun.code).toBe(1);
    const sarif = JSON.parse(await readFile(output, "utf8")) as {
      version: string;
      runs: {
        tool: { driver: { name: string; rules: { id: string }[] } };
        results: {
          ruleId: string;
          locations: { physicalLocation: { region: { startLine: number } } }[];
        }[];
      }[];
    };
    expect(sarif.version).toBe("2.1.0");
    expect(sarif.runs[0]?.tool.driver.rules.map(({ id }) => id)).toEqual(["links", "wikilinks"]);
    expect(sarif.runs[0]?.results.map(({ ruleId }) => ruleId)).toEqual(["wikilinks", "links"]);

    const jsonRun = await cliRun("--format", "json", join(base, "broken"));
    const json = JSON.parse(jsonRun.stdout) as { status: string; findings: unknown[] };
    expect(json.status).toBe("failed");
    expect(json.findings).toHaveLength(2);
  });

  it("produces byte-identical reports for identical input", async () => {
    const first = await cliRun("--format", "sarif", join(base, "broken"));
    const second = await cliRun("--format", "sarif", join(base, "broken"));
    expect(second.stdout).toBe(first.stdout);
  });
});
