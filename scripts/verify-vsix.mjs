import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { inflateRawSync } from "node:zlib";

/** Reads every entry of a ZIP file (stored or deflated), as a VSIX is. */
export function readZip(buffer) {
  const end = buffer.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (end < 0) {
    throw new Error("Not a ZIP file: no end of central directory.");
  }
  const count = buffer.readUInt16LE(end + 10);
  let offset = buffer.readUInt32LE(end + 16);
  const entries = new Map();
  for (let index = 0; index < count; index++) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) {
      throw new Error("Corrupt central directory.");
    }
    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.toString("utf8", offset + 46, offset + 46 + nameLength);
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const start = localOffset + 30 + localNameLength + localExtraLength;
    const data = buffer.subarray(start, start + compressedSize);
    if (method !== 0 && method !== 8) {
      throw new Error(`Unsupported compression in ${name}.`);
    }
    entries.set(name, method === 8 ? inflateRawSync(data) : Buffer.from(data));
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

const REQUIRED = [
  "extension.vsixmanifest",
  "extension/package.json",
  "extension/package.nls.json",
  "extension/package.nls.de.json",
  "extension/readme.md",
  "extension/LICENSE.txt",
  "extension/NOTICE",
  "extension/dist/extension.js",
  "extension/dist/server.js",
  "extension/dist/THIRD_PARTY_NOTICES.txt",
  "extension/dist/profile.schema.json",
  "extension/dist/webview/main.js",
  "extension/dist/webview/main.css",
  "extension/dist/webview/properties.js",
  "extension/dist/webview/properties.css",
];

const FORBIDDEN = [
  /\.map$/,
  /\.ts$/,
  /(^|\/)node_modules\//,
  /^extension\/(src|test|out|scripts)\//,
  /(^|\/)\.env/,
  /\.vsix$/,
];

/**
 * Checks the content of a VSIX: the bundles, the localized manifest
 * strings, the Apache-2.0 license, NOTICE, and the third-party notices are there; sources, tests,
 * source maps, and dependencies are not; the manifest declares the expected identity. Returns the
 * content digest, a SHA-256 over every entry name and its bytes, which is equal for two builds of
 * the same commit even though ZIP timestamps differ.
 */
export async function verifyVsix(file, expected) {
  const entries = readZip(await readFile(file));
  const names = [...entries.keys()].sort();
  const problems = [];
  for (const name of REQUIRED) {
    if (!entries.has(name)) {
      problems.push(`missing ${name}`);
    }
  }
  for (const name of names) {
    if (FORBIDDEN.some((pattern) => pattern.test(name))) {
      problems.push(`must not contain ${name}`);
    }
  }
  const manifest = JSON.parse(entries.get("extension/package.json")?.toString("utf8") ?? "{}");
  for (const [key, value] of Object.entries(expected)) {
    if (manifest[key] !== value) {
      problems.push(
        `package.json ${key} is ${JSON.stringify(manifest[key])}, expected ${JSON.stringify(value)}`,
      );
    }
  }
  const license = entries.get("extension/LICENSE.txt")?.toString("utf8") ?? "";
  if (!license.includes("Apache License") || !license.includes("Version 2.0, January 2004")) {
    problems.push("LICENSE.txt is not the Apache License 2.0");
  }
  if (problems.length > 0) {
    throw new Error(`The VSIX ${file} is not valid:\n  ${problems.join("\n  ")}`);
  }
  const digest = createHash("sha256");
  for (const name of names) {
    digest.update(`${name}\0${createHash("sha256").update(entries.get(name)).digest("hex")}\n`);
  }
  return { entries: names.length, digest: digest.digest("hex") };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [file] = process.argv.slice(2);
  if (!file) {
    console.error("Usage: node scripts/verify-vsix.mjs <file.vsix>");
    process.exit(2);
  }
  const { version, publisher, name, license } = JSON.parse(
    await readFile(new URL("../packages/extension/package.json", import.meta.url), "utf8"),
  );
  const result = await verifyVsix(file, { version, publisher, name, license });
  console.log(`${file}: ${String(result.entries)} entries, content digest ${result.digest}`);
}
