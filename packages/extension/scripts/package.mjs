import { execFileSync } from "node:child_process";
import { copyFile, mkdir, readFile, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { verifyVsix } from "../../../scripts/verify-vsix.mjs";

/*
 * Builds the VSIX from the current checkout: bundles with esbuild,
 * adds the repository's LICENSE and NOTICE, packages with vsce without node_modules (everything
 * is bundled), and verifies the result. The file is written to `dist/` at the repository root.
 */
const extension = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const root = resolve(extension, "../..");
const manifest = JSON.parse(await readFile(join(extension, "package.json"), "utf8"));
const out = join(root, "dist", `${manifest.name}-${manifest.version}.vsix`);
const vsce = join(
  dirname(createRequire(import.meta.url).resolve("@vscode/vsce/package.json")),
  "vsce",
);
const run = (args) => execFileSync(process.execPath, args, { cwd: extension, stdio: "inherit" });

run(["esbuild.mjs"]);
const copied = ["LICENSE", "NOTICE"].map((name) => join(extension, name));
try {
  await Promise.all(
    copied.map((target) => copyFile(join(root, target.slice(extension.length + 1)), target)),
  );
  await mkdir(dirname(out), { recursive: true });
  run([vsce, "package", "--no-dependencies", "--out", out]);
} finally {
  await Promise.all(copied.map((target) => rm(target, { force: true })));
}
const { version, publisher, name, license } = manifest;
const result = await verifyVsix(out, { version, publisher, name, license });
console.log(`Verified ${out}: ${String(result.entries)} entries, content digest ${result.digest}`);
