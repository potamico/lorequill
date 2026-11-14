// Generates src/generated/profile.ts from schema/profile.schema.json.
//
//   node scripts/generate-types.mjs          write the generated file
//   node scripts/generate-types.mjs --check  fail if the file is stale

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { compile } from "json-schema-to-typescript";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const schemaPath = resolve(packageRoot, "schema/profile.schema.json");
export const outputPath = resolve(packageRoot, "src/generated/profile.ts");

const banner = `/* eslint-disable */
// This file is generated from schema/profile.schema.json by scripts/generate-types.mjs.
// Do not edit it by hand. Run \`npm run generate:types --workspace @lorequill/profile\`.`;

/** Returns the expected content of the generated file. */
export async function generate() {
  const schema = JSON.parse(await readFile(schemaPath, "utf8"));
  return compile(schema, "Profile", {
    bannerComment: banner,
    additionalProperties: false,
    unreachableDefinitions: false,
    format: true,
  });
}

async function main() {
  const expected = await generate();
  if (process.argv.includes("--check")) {
    const actual = await readFile(outputPath, "utf8").catch(() => "");
    if (actual !== expected) {
      console.error(
        "src/generated/profile.ts is stale. Run `npm run generate:types --workspace @lorequill/profile`.",
      );
      process.exitCode = 1;
    }
    return;
  }
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, expected, "utf8");
  console.log(`Wrote ${outputPath}`);
}

// Run only when executed directly, not when imported by tests.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
