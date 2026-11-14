import { readdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";

const LICENSE_FILE = /^(?:licen[cs]e|copying|notice)(?:[.-].*)?$/i;

/** The package directory of a bundled input path below `node_modules`, or `undefined`. */
function packageDirectory(absolute) {
  const parts = absolute.split(sep);
  const index = parts.lastIndexOf("node_modules");
  if (index < 0) {
    return undefined;
  }
  const scoped = parts[index + 1]?.startsWith("@");
  return parts.slice(0, index + (scoped ? 3 : 2)).join(sep);
}

/**
 * Writes the license texts of every third-party package that esbuild bundled (from its
 * metafiles) into one notices file, sorted by package name, so bundles keep the notices that
 * their licenses require. Inputs are resolved against `workingDirectory`, as esbuild reports them.
 */
export async function writeThirdPartyNotices({ metafiles, workingDirectory, outFile, title }) {
  const directories = new Set();
  for (const metafile of metafiles) {
    for (const input of Object.keys(metafile.inputs)) {
      const directory = packageDirectory(resolve(workingDirectory, input));
      if (directory) {
        directories.add(directory);
      }
    }
  }
  const entries = [];
  for (const directory of directories) {
    const manifest = JSON.parse(await readFile(join(directory, "package.json"), "utf8"));
    const files = (await readdir(directory)).filter((name) => LICENSE_FILE.test(name)).sort();
    const texts = await Promise.all(
      files.map(async (name) => (await readFile(join(directory, name), "utf8")).trim()),
    );
    entries.push({
      name: manifest.name,
      version: manifest.version,
      license: typeof manifest.license === "string" ? manifest.license : "see license text",
      texts,
    });
  }
  entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const missing = entries.filter(({ texts }) => texts.length === 0).map(({ name }) => name);
  if (missing.length > 0) {
    throw new Error(`No license file found for: ${missing.join(", ")}`);
  }
  const rule = "-".repeat(78);
  const body = entries
    .map(
      ({ name, version, license, texts }) =>
        `${rule}\n${name} ${version} (${license})\n${rule}\n\n${texts.join("\n\n")}\n`,
    )
    .join("\n");
  await writeFile(
    outFile,
    `${title}\n\nThis file lists the third-party software included in this bundle and its license\nnotices. Lorequill itself is licensed under the Apache License, Version 2.0.\n\n${body}`,
    "utf8",
  );
  return entries.map(({ name }) => name);
}
