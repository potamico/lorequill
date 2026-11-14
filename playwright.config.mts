import { defineConfig, devices } from "@playwright/test";

// Webview tests: the built editor webview (packages/extension/dist/webview) runs in Chromium,
// the engine of VS Code's webviews, with a simulated host. Run `npm run build` first.
export default defineConfig({
  testDir: "packages/extension/test/webview",
  testMatch: "**/*.spec.ts",
  fullyParallel: true,
  forbidOnly: true,
  retries: 0,
  reporter: "list",
  timeout: 15_000,
  use: {
    ...devices["Desktop Chrome"],
    viewport: { width: 1100, height: 700 },
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
});
