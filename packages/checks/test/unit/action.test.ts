import { execFile } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ACTION_EXIT, command, runAction } from "../../src/action";
import { ENGINE_VERSION } from "../../src";

/*
 * Acceptance test 40: the pinned CI engine reports its version and runs without executing
 * repository-defined code. The tests run the Action's logic and the committed bundle that
 * `action.yml` points to, against fixture repositories in a temporary workspace.
 */

const run = promisify(execFile);
const BUNDLE = resolve(import.meta.dirname, "../../../../action/dist/index.cjs");
let workspace: string;

const PROFILE = `version: 1
content:
  root: docs
  include: ["**/*.md"]
checks:
  rules:
    - { id: links, rule: relative-links }
    - { id: wikilinks, rule: forbidden-text, text: "[[" }
`;

async function writeRepository(name: string, files: Record<string, string>): Promise<void> {
  for (const [path, text] of Object.entries(files)) {
    await mkdir(dirname(join(workspace, name, path)), { recursive: true });
    await writeFile(join(workspace, name, path), text);
  }
}

/** Files that would leave a marker if anything from the repository ran. */
function hostileFiles(marker: string): Record<string, string> {
  const script = `require("fs").writeFileSync(${JSON.stringify(marker)}, "ran")`;
  return {
    "package.json": JSON.stringify({
      scripts: { preinstall: `node -e '${script}'`, test: `node -e '${script}'` },
    }),
    ".git/hooks/post-checkout": `#!/bin/sh\ntouch ${JSON.stringify(marker)}\n`,
    ".lorequill/hooks.js": script,
    "docs/script.md": `# Script\n\n<script>${script}</script>\n\n\`\`\`js\n${script}\n\`\`\`\n`,
  };
}

interface Run {
  readonly code: number;
  readonly stdout: string;
  readonly outputs: Record<string, string>;
  readonly summary: string;
}

async function runInProcess(inputs: Record<string, string>): Promise<Run> {
  const outputFile = join(workspace, `output-${String(Math.random()).slice(2)}`);
  const summaryFile = `${outputFile}-summary`;
  let stdout = "";
  const env: NodeJS.ProcessEnv = {
    GITHUB_WORKSPACE: workspace,
    GITHUB_OUTPUT: outputFile,
    GITHUB_STEP_SUMMARY: summaryFile,
  };
  for (const [name, value] of Object.entries(inputs)) {
    env[`INPUT_${name.toUpperCase()}`] = value;
  }
  const code = await runAction(env, { stdout: (text) => (stdout += text) });
  const read = (file: string): Promise<string> => readFile(file, "utf8").catch(() => "");
  const outputs = Object.fromEntries(
    (await read(outputFile))
      .split("\n")
      .filter(Boolean)
      .map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)]),
  );
  return { code, stdout, outputs, summary: await read(summaryFile) };
}

beforeAll(async () => {
  workspace = await mkdtemp(join(tmpdir(), "lorequill-action-"));
  await writeRepository("clean", {
    ".lorequill/config.yaml": PROFILE,
    "docs/index.md": "# Start\n\n[Setup](guides/setup.md)\n",
    "docs/guides/setup.md": "# Setup\n",
  });
  await writeRepository("broken", {
    ".lorequill/config.yaml": PROFILE,
    "docs/index.md": "# Start\n\n[[wiki]] and [gone](gone.md)\n",
  });
  await writeRepository("hostile", {
    ".lorequill/config.yaml": PROFILE,
    ...hostileFiles(join(workspace, "pwned")),
  });
  await writeRepository("invalid", { ".lorequill/config.yaml": "version: 1\ncommand: rm -rf /\n" });
});

afterAll(async () => {
  await rm(workspace, { recursive: true, force: true });
});

describe("Lorequill checks Action", () => {
  it("prints the engine version and passes a clean repository", async () => {
    const result = await runInProcess({ path: "clean" });
    expect(result.code).toBe(ACTION_EXIT.passed);
    expect(result.stdout.split("\n")[0]).toBe(`Lorequill checks engine ${ENGINE_VERSION}`);
    expect(result.outputs).toEqual({
      "engine-version": ENGINE_VERSION,
      status: "passed",
      findings: "0",
    });
    expect(result.summary).toContain(`Engine ${ENGINE_VERSION}: 2 pages, 0 findings, passed.`);
  });

  it("annotates findings with workspace paths, writes SARIF, and fails", async () => {
    const result = await runInProcess({ path: "broken", "sarif-file": "out/../broken.sarif" });
    expect(result.code).toBe(ACTION_EXIT.findings);
    expect(result.outputs.status).toBe("failed");
    expect(result.outputs.findings).toBe("2");
    expect(result.stdout).toMatch(
      /^::error file=broken\/docs\/index\.md,line=3,col=\d+,.*title=Lorequill wikilinks::/m,
    );
    expect(result.stdout).toMatch(
      /^::error file=broken\/docs\/index\.md,.*title=Lorequill links::/m,
    );
    const sarif = JSON.parse(await readFile(join(workspace, "broken.sarif"), "utf8")) as {
      version: string;
      runs: { tool: { driver: { semanticVersion: string } }; results: unknown[] }[];
    };
    expect(sarif.version).toBe("2.1.0");
    expect(sarif.runs[0]?.tool.driver.semanticVersion).toBe(ENGINE_VERSION);
    expect(sarif.runs[0]?.results).toHaveLength(2);
    expect(result.outputs["sarif-file"]).toBe(join(workspace, "broken.sarif"));
  });

  it("can report findings without failing the step", async () => {
    const result = await runInProcess({ path: "broken", "fail-on-findings": "false" });
    expect(result.code).toBe(ACTION_EXIT.passed);
    expect(result.outputs.status).toBe("failed");
  });

  it("fails on a profile that is not valid, without running anything", async () => {
    const result = await runInProcess({ path: "invalid" });
    expect(result.code).toBe(ACTION_EXIT.error);
    expect(result.outputs.status).toBe("error");
    expect(result.stdout).toMatch(/^::error title=Lorequill::The profile .*%0A/m);
  });

  it("keeps page content from being read as workflow commands", async () => {
    await writeRepository("injection", {
      ".lorequill/config.yaml": PROFILE,
      "docs/index.md": "# Start\n\n[x](::add-mask::secret.md)\n",
    });
    const result = await runInProcess({ path: "injection" });
    const lines = result.stdout.split("\n");
    const start = lines.findIndex((line) => line.startsWith("::stop-commands::"));
    const token = lines[start]?.slice("::stop-commands::".length) ?? "";
    expect(token).toMatch(/^[0-9a-f]{32}$/);
    const end = lines.indexOf(`::${token}::`);
    expect(end).toBeGreaterThan(start);
    // The report lies between the markers; only escaped annotations follow.
    expect(lines.slice(start + 1, end).join("\n")).toContain("::add-mask::secret.md");
    expect(lines.slice(end + 1).every((line) => line === "" || line.startsWith("::error "))).toBe(
      true,
    );
  });

  it("escapes workflow command data and properties", () => {
    expect(command("error", { file: "a,b:c.md", line: 1 }, "50%\nnext")).toBe(
      "::error file=a%2Cb%3Ac.md,line=1::50%25%0Anext",
    );
  });

  it("runs the committed bundle without executing repository code (AT 40)", async () => {
    const env: NodeJS.ProcessEnv = {
      PATH: process.env.PATH,
      GITHUB_WORKSPACE: workspace,
      INPUT_PATH: "hostile",
    };
    const { stdout } = await run(process.execPath, [BUNDLE], { env, encoding: "utf8" });
    expect(stdout.split("\n")[0]).toBe(`Lorequill checks engine ${ENGINE_VERSION}`);
    expect(stdout).toContain("passed");
    await expect(access(join(workspace, "pwned"))).rejects.toThrow();
  });
});
