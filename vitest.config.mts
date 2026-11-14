import { defineConfig } from "vitest/config";

// Unit and fixture tests only. Tests that need a VS Code host live in
// packages/extension/test/integration and run through @vscode/test-electron.
export default defineConfig({
  test: {
    include: ["packages/*/test/unit/**/*.test.ts"],
    environment: "node",
  },
});
