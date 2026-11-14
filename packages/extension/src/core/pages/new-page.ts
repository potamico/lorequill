import { updateFrontMatter, type FrontMatterEdit } from "@lorequill/markdown";
import type { Collection } from "@lorequill/profile";
import { expandDefault, folderMatches } from "../properties/collections";

/** Why a file name for a new page is rejected. */
export type FileNameProblem =
  "empty" | "separator" | "invalid-character" | "reserved" | "too-long" | "exists";

// Characters Windows forbids in file names, and control characters.
// eslint-disable-next-line no-control-regex -- control characters are rejected on purpose.
const INVALID_CHARACTERS = /[<>:"|?*\u0000-\u001f\u007f]/u;
const RESERVED_STEMS = new Set([
  "con",
  "prn",
  "aux",
  "nul",
  ...Array.from({ length: 10 }, (_, index) => `com${String(index)}`),
  ...Array.from({ length: 10 }, (_, index) => `lpt${String(index)}`),
]);
const MAX_FILE_NAME_BYTES = 255;

/** The file name as it will be created: trimmed, with `.md` appended if it has no such ending. */
export function normalizeFileName(input: string): string {
  const name = input.trim().normalize("NFC");
  return name === "" || /\.md$/i.test(name) ? name : `${name}.md`;
}

/**
 * Checks a file name for a new page in one directory (specification §8): a single path segment,
 * no characters any supported platform forbids, no reserved device name, and no existing file of
 * the same name, compared case-insensitively. A path segment can never leave the directory.
 */
export function checkFileName(
  name: string,
  existingFileNames: Iterable<string>,
): FileNameProblem | undefined {
  const stem = name.replace(/\.md$/i, "");
  if (stem.trim() === "") {
    return "empty";
  }
  if (name.includes("/") || name.includes("\\")) {
    return "separator";
  }
  if (INVALID_CHARACTERS.test(name) || /[. ]$/.test(name) || name.startsWith(".")) {
    return "invalid-character";
  }
  if (RESERVED_STEMS.has(stem.split(".")[0]?.toLowerCase() ?? "")) {
    return "reserved";
  }
  if (new TextEncoder().encode(name).length > MAX_FILE_NAME_BYTES) {
    return "too-long";
  }
  const key = name.toLowerCase();
  for (const existing of existingFileNames) {
    if (existing.normalize("NFC").toLowerCase() === key) {
      return "exists";
    }
  }
  return undefined;
}

/** POSIX path of a page in `directory` (relative to the content root; empty for the root). */
export function pagePathIn(directory: string, fileName: string): string {
  return directory === "" ? fileName : `${directory}/${fileName}`;
}

/**
 * Collections a new page in `pagePath` can use: those whose folder is exactly its directory. The
 * `match` field is not checked, because the new page gets its value from the collection's
 * defaults. Several results must be resolved by the author (§6).
 */
export function collectionsForNewPage(
  collections: readonly Collection[],
  pagePath: string,
): Collection[] {
  return collections.filter((collection) => folderMatches(collection.folder, pagePath));
}

/**
 * The text of a new page (specification §6). Without a collection it is a heading with the title.
 * With a collection, the front matter gets the title (if the collection has a `title` field), the
 * value its `match` requires, and every field default, with `{domain}` expanded; the body is the
 * collection's template with `{title}` replaced, or the heading.
 */
export function newPageText(
  title: string,
  pagePath: string,
  collection: Collection | undefined,
): string {
  const cleanTitle = title.replace(/\s+/g, " ").trim();
  const heading = `# ${cleanTitle}\n`;
  if (!collection) {
    return heading;
  }
  const match = collection.match;
  const edits: FrontMatterEdit[] = [];
  for (const field of collection.fields ?? []) {
    if (match?.field === field.key) {
      // The page must belong to its collection, whatever the field's default says.
      edits.push({ op: "set", key: field.key, value: match.equals });
    } else if (field.key === "title" && field.widget !== "boolean" && field.widget !== "list") {
      edits.push({ op: "set", key: "title", value: cleanTitle });
    } else if (typeof field.default === "string") {
      const value = expandDefault(field.default, pagePath);
      edits.push(
        field.widget === "date"
          ? { op: "set-date", key: field.key, value }
          : { op: "set", key: field.key, value },
      );
    } else if (typeof field.default === "boolean") {
      edits.push({ op: "set", key: field.key, value: field.default });
    } else if (Array.isArray(field.default)) {
      const items = field.default.map((item) => expandDefault(item, pagePath));
      edits.push({ op: "set", key: field.key, value: items });
    }
  }
  if (match && !edits.some(({ key }) => key === match.field)) {
    edits.push({ op: "set", key: match.field, value: match.equals });
  }
  const body = collection.template
    ? collection.template.replaceAll("{title}", cleanTitle)
    : heading;
  const result = updateFrontMatter(body.endsWith("\n") ? body : `${body}\n`, edits);
  return result.ok ? result.text : body;
}
