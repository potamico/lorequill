import { mkdir, writeFile } from "node:fs/promises";
import { build } from "esbuild";
import { writeThirdPartyNotices } from "../../scripts/third-party-notices.mjs";

// Bundles the CLI into one CommonJS file, so it runs with plain Node.js and no install step.
await build({
  entryPoints: ["src/bin.ts"],
  bundle: true,
  platform: "node",
  target: "node22",
  format: "cjs",
  outfile: "dist/cli.cjs",
  banner: { js: "#!/usr/bin/env node" },
  sourcemap: true,
  logLevel: "info",
});

// The GitHub Action (`action/`): one committed file that GitHub runs with its Node.js runtime,
// so a workflow installs nothing. Without source maps or absolute paths, so it builds
// byte-identically from a clean checkout and CI can compare it with the committed file.
const action = await build({
  entryPoints: ["src/action-bin.ts"],
  bundle: true,
  platform: "node",
  target: "node24",
  format: "cjs",
  outfile: "../../action/dist/index.cjs",
  legalComments: "none",
  metafile: true,
  logLevel: "info",
});
await mkdir("../../action/dist", { recursive: true });
await writeThirdPartyNotices({
  metafiles: [action.metafile],
  workingDirectory: process.cwd(),
  outFile: "../../action/dist/THIRD_PARTY_NOTICES.txt",
  title: "Lorequill checks Action - third-party notices",
});
await writeFile("../../action/dist/.gitattributes", "* -text\n");
