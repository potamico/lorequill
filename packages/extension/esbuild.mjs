import { copyFile, mkdir } from "node:fs/promises";
import { build, context } from "esbuild";
import { writeThirdPartyNotices } from "../../scripts/third-party-notices.mjs";
import { browser, inlineWorker } from "./webview-build.mjs";

const watch = process.argv.includes("--watch");

/** @type {import("esbuild").BuildOptions[]} */
const builds = [
  {
    // The language server runs in its own Node process and is bundled next to the extension.
    entryPoints: { extension: "src/extension.ts", server: "../server/src/server.ts" },
    outdir: "dist",
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node22",
    external: ["vscode"],
    sourcemap: true,
    metafile: true,
    logLevel: "info",
  },
  {
    // The page editor runs in a webview: a browser bundle with its stylesheet.
    ...browser,
    entryPoints: {
      main: "../editor/src/webview/main.ts",
      properties: "../editor/src/properties/main.ts",
    },
    outdir: "dist/webview",
    format: "iife",
    sourcemap: true,
    loader: { ".css": "css", ".ttf": "file" },
    metafile: true,
    plugins: [inlineWorker],
  },
];

// The profile schema, so that the YAML extension can complete and check .lorequill/config.yaml.
await mkdir("dist", { recursive: true });
await copyFile("../profile/schema/profile.schema.json", "dist/profile.schema.json");

if (watch) {
  for (const options of builds) {
    const ctx = await context(options);
    await ctx.watch();
  }
} else {
  const results = await Promise.all(builds.map((options) => build(options)));
  // The license notices of every bundled third-party package, shipped in the VSIX.
  await writeThirdPartyNotices({
    metafiles: results.map(({ metafile }) => metafile),
    workingDirectory: process.cwd(),
    outFile: "dist/THIRD_PARTY_NOTICES.txt",
    title: "Lorequill extension - third-party notices",
  });
}
