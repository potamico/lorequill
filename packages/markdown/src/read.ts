import { isMap, isNode, isScalar, type Document } from "yaml";
import { findFrontMatter, type FrontMatterBlock } from "./front-matter";
import type { FrontMatterIssue } from "./issues";
import { lineNumberAt } from "./lines";
import { parseSafeYaml } from "./safe-yaml";

export type FrontMatterData = Readonly<Record<string, unknown>>;

export type FrontMatterReadResult =
  /** The text has no front matter block. */
  | { readonly status: "none" }
  /** The front matter is valid YAML data with a mapping at the top level (possibly empty). */
  | { readonly status: "ok"; readonly block: FrontMatterBlock; readonly data: FrontMatterData }
  /** The YAML cannot be handled safely. The properties panel must be read-only for this file. */
  | {
      readonly status: "invalid";
      readonly block: FrontMatterBlock;
      readonly issues: readonly FrontMatterIssue[];
    };

/** Like the `ok` result, but also carries the parsed YAML document for node-level edits. */
export interface LoadedFrontMatter {
  readonly status: "ok";
  readonly block: FrontMatterBlock;
  readonly data: FrontMatterData;
  readonly document: Document.Parsed;
}

export type LoadResult =
  | { readonly status: "none" }
  | LoadedFrontMatter
  | Extract<FrontMatterReadResult, { status: "invalid" }>;

/** @internal Shared by `readFrontMatter` and `updateFrontMatter`. */
export function loadFrontMatter(text: string): LoadResult {
  const block = findFrontMatter(text);
  if (!block) {
    return { status: "none" };
  }

  const source = text.slice(block.contentStart, block.contentEnd);
  const firstLine = lineNumberAt(text, block.contentStart);
  const { document, issues } = parseSafeYaml(source, firstLine);
  if (issues.length > 0) {
    return { status: "invalid", block, issues };
  }

  const contents = document.contents;
  if (contents !== null && !isMap(contents)) {
    const offset = isNode(contents) ? contents.range[0] : undefined;
    const line = offset === undefined ? firstLine : lineNumberAt(text, block.contentStart + offset);
    return {
      status: "invalid",
      block,
      issues: [{ code: "front-matter-not-a-mapping", line }],
    };
  }

  const data = (contents === null ? {} : document.toJS()) as FrontMatterData;
  return { status: "ok", block, data, document };
}

/**
 * Reads the YAML front matter of a Markdown text as data. Never modifies anything.
 *
 * Unknown keys are returned like known ones. YAML is parsed with the 1.2 core schema, so a value
 * such as `2026-01-01` is a string and `yes` is a string, not a date or a boolean.
 */
export function readFrontMatter(text: string): FrontMatterReadResult {
  const loaded = loadFrontMatter(text);
  if (loaded.status === "ok") {
    return { status: "ok", block: loaded.block, data: loaded.data };
  }
  return loaded;
}

export type FrontMatterFieldResult =
  /** The text has no front matter, or the front matter has no such key. */
  | { readonly status: "missing" }
  /** The front matter cannot be read safely; `line` is where its first problem is. */
  | { readonly status: "invalid"; readonly line: number }
  /** The key exists. `value` is the YAML value as data; `line` is the 1-based line of the key. */
  | { readonly status: "ok"; readonly value: unknown; readonly line: number };

/** Reads one top-level front matter field with the line of its key, for check findings. */
export function readFrontMatterField(text: string, key: string): FrontMatterFieldResult {
  const loaded = loadFrontMatter(text);
  if (loaded.status === "none") {
    return { status: "missing" };
  }
  if (loaded.status === "invalid") {
    return {
      status: "invalid",
      line: loaded.issues[0]?.line ?? lineNumberAt(text, loaded.block.start),
    };
  }
  const contents = loaded.document.contents;
  if (!isMap(contents)) {
    return { status: "missing" };
  }
  for (const pair of contents.items) {
    if (isScalar(pair.key) && pair.key.value === key && Object.hasOwn(loaded.data, key)) {
      const offset = pair.key.range[0];
      return {
        status: "ok",
        value: loaded.data[key],
        line: lineNumberAt(text, loaded.block.contentStart + offset),
      };
    }
  }
  return { status: "missing" };
}
