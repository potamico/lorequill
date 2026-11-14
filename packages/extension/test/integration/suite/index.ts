import { readdir } from "node:fs/promises";
import * as path from "node:path";
import Mocha from "mocha";

/**
 * Entry point called by VS Code's extension host. Runs the tests of one scenario: the folder
 * `suite/<scenario>/` selected by the LOREQUILL_SCENARIO environment variable, which the runner
 * sets for each VS Code instance it starts.
 */
export async function run(): Promise<void> {
  const scenario = process.env.LOREQUILL_SCENARIO;
  if (!scenario || !/^[a-z-]+$/.test(scenario)) {
    throw new Error("LOREQUILL_SCENARIO must name a scenario folder.");
  }

  // Long enough for a webview to start on a slow CI machine (WEBVIEW_TIMEOUT_MS) and the test after it.
  const mocha = new Mocha({ ui: "tdd", color: true, timeout: 90_000 });
  const testsRoot = path.join(__dirname, scenario);

  const entries = await readdir(testsRoot, { recursive: true });
  const files = entries.filter((name) => name.endsWith(".test.js")).sort();
  if (files.length === 0) {
    throw new Error(`No tests found for scenario ${scenario}.`);
  }
  for (const entry of files) {
    mocha.addFile(path.resolve(testsRoot, entry));
  }

  await new Promise<void>((resolve, reject) => {
    mocha.run((failures) => {
      if (failures > 0) {
        reject(new Error(`${String(failures)} integration test(s) failed.`));
      } else {
        resolve();
      }
    });
  });
}
