import js from "@eslint/js";
import prettier from "eslint-config-prettier";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/out/**",
      "**/node_modules/**",
      "**/.vscode-test/**",
      "**/.venv/**",
      "samples/demo/site/**",
      "site/**",
      "**/coverage/**",
      "**/src/generated/**",
      "**/*.vsix",
      "test-results/**",
      "playwright-report/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      globals: { ...globals.node },
      parserOptions: {
        projectService: {
          allowDefaultProject: ["*.mjs", "*.mts"],
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": "error",
      eqeqeq: ["error", "always"],
      "no-console": "error",
    },
  },
  {
    // Only the extension host code may import `vscode`. Shared packages and the extension's own
    // core logic stay free of it so that they can be unit-tested and reused by the CLI and the
    // language server.
    files: [
      "packages/profile/**/*.ts",
      "packages/markdown/**/*.ts",
      "packages/extension/src/core/**/*.ts",
      "packages/extension/test/unit/**/*.ts",
    ],
    rules: {
      "no-restricted-imports": [
        "error",
        { paths: [{ name: "vscode", message: "This code must not depend on VS Code." }] },
      ],
    },
  },
  {
    files: ["**/*.mjs", "**/*.js"],
    ...tseslint.configs.disableTypeChecked,
  },
  {
    // Build and tooling scripts may print to the console.
    files: ["**/*.mjs"],
    rules: { "no-console": "off" },
  },
  prettier,
);
