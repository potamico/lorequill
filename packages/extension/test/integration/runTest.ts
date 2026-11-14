import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { downloadAndUnzipVSCode, runTests } from "@vscode/test-electron";
import { createWorkspaces } from "./workspaces";

/**
 * Launches a real VS Code instance with the extension loaded and runs the Mocha
 * suite in test/integration/suite inside its extension host.
 */
/**
 * When this runner is started from the integrated terminal of VS Code (or a fork such as Cursor),
 * the terminal inherits variables of the host editor. `ELECTRON_RUN_AS_NODE` makes the downloaded
 * VS Code binary behave like plain Node.js and reject every VS Code option, and `VSCODE_*`
 * variables such as `VSCODE_IPC_HOOK_CLI` can attach the test instance to the running editor.
 * The test instance must start clean, so these variables are removed for this process and the
 * child process it spawns.
 */
function removeHostEditorEnvironment(): void {
  for (const name of Object.keys(process.env)) {
    if (name === "ELECTRON_RUN_AS_NODE" || name.startsWith("VSCODE_")) {
      Reflect.deleteProperty(process.env, name);
    }
  }
}

interface Launch {
  readonly extensionDevelopmentPath: string;
  readonly extensionTestsPath: string;
  readonly scenario: string;
  readonly workspace: string;
  readonly userDataDir: string;
}

/**
 * Starts VS Code with workspace trust enabled. `runTests` always appends
 * `--disable-workspace-trust`, so a workspace that must start untrusted cannot be launched with
 * it. The arguments below are the ones `runTests` uses, without that flag.
 */
async function runWithWorkspaceTrust(launch: Launch): Promise<void> {
  const executable = await downloadAndUnzipVSCode();
  const args = [
    launch.workspace,
    "--no-sandbox",
    "--disable-gpu-sandbox",
    "--disable-updates",
    "--skip-welcome",
    "--skip-release-notes",
    "--no-cached-data",
    "--disable-extensions",
    `--user-data-dir=${launch.userDataDir}`,
    `--extensions-dir=${path.join(launch.userDataDir, "extensions")}`,
    `--extensionTestsPath=${launch.extensionTestsPath}`,
    `--extensionDevelopmentPath=${launch.extensionDevelopmentPath}`,
  ];
  await new Promise<void>((resolve, reject) => {
    const child = spawn(executable, args, {
      env: { ...process.env, LOREQUILL_SCENARIO: launch.scenario },
      stdio: "inherit",
    });
    child.on("error", reject);
    child.on("close", (code, signal) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`VS Code exited with ${String(code ?? signal)}.`));
      }
    });
  });
}

async function main(): Promise<void> {
  removeHostEditorEnvironment();

  // Compiled location: packages/extension/out/test/integration/runTest.js
  const extensionDevelopmentPath = path.resolve(__dirname, "../../..");
  const extensionTestsPath = path.resolve(__dirname, "suite/index");
  const workspaces = await createWorkspaces(
    path.join(extensionDevelopmentPath, ".vscode-test", "workspaces"),
  );

  // Each scenario starts its own VS Code instance, because the workspace and its trust state are
  // fixed at startup. The scenario name selects the test folder in suite/.
  const scenarios = [
    { name: "trusted", workspace: workspaces.single, trust: false },
    { name: "untrusted", workspace: workspaces.single, trust: true },
    { name: "multi-root", workspace: workspaces.multiRoot, trust: false },
    { name: "checks", workspace: workspaces.checks, trust: false },
    { name: "editor", workspace: workspaces.editor, trust: false },
    { name: "git", workspace: workspaces.git, trust: false },
  ];

  // VS Code creates its IPC socket inside the user data directory. macOS allows at most 103
  // characters for a socket path, which a directory inside a deep checkout can exceed, so the
  // user data lives in a short temporary directory instead.
  const userDataRoot = await mkdtemp(path.join(tmpdir(), "lq-"));
  try {
    for (const scenario of scenarios) {
      await runScenario(scenario, {
        extensionDevelopmentPath,
        extensionTestsPath,
        userDataRoot,
      });
    }
  } finally {
    await rm(userDataRoot, { recursive: true, force: true });
  }
}

interface Scenario {
  readonly name: string;
  readonly workspace: string;
  readonly trust: boolean;
}

async function runScenario(
  scenario: Scenario,
  paths: {
    readonly extensionDevelopmentPath: string;
    readonly extensionTestsPath: string;
    readonly userDataRoot: string;
  },
): Promise<void> {
  const { extensionDevelopmentPath, extensionTestsPath } = paths;
  // A fresh user data directory per scenario keeps trust decisions and other state from one
  // scenario from leaking into the next.
  const userDataDir = path.join(paths.userDataRoot, scenario.name);
  await mkdir(path.join(userDataDir, "User"), { recursive: true });
  await writeFile(
    path.join(userDataDir, "User", "settings.json"),
    JSON.stringify({
      "security.workspace.trust.enabled": scenario.trust,
      "security.workspace.trust.startupPrompt": "never",
      "security.workspace.trust.banner": "never",
    }),
  );
  if (scenario.trust) {
    await runWithWorkspaceTrust({
      extensionDevelopmentPath,
      extensionTestsPath,
      scenario: scenario.name,
      workspace: scenario.workspace,
      userDataDir,
    });
  } else {
    await runTests({
      extensionDevelopmentPath,
      extensionTestsPath,
      extensionTestsEnv: { LOREQUILL_SCENARIO: scenario.name },
      launchArgs: [scenario.workspace, "--disable-extensions", `--user-data-dir=${userDataDir}`],
    });
  }
}

main().catch((error: unknown) => {
  // eslint-disable-next-line no-console
  console.error("Failed to run integration tests:", error);
  process.exit(1);
});
