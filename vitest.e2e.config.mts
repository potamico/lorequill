import { defineConfig } from "vitest/config";

// End-to-end tests against real Git hosts. They are skipped unless their environment variables
// name a disposable test repository and a token; see docs/development.md.
export default defineConfig({
  test: {
    include: ["packages/*/test/e2e/**/*.test.ts"],
    environment: "node",
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
});
