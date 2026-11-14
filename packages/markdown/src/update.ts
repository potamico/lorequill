import { isDeepStrictEqual } from "node:util";
import { Scalar, YAMLSeq, isMap, isNode, isScalar, isSeq, type Document } from "yaml";
import type { FrontMatterIssue } from "./issues";
import { detectLineEnding } from "./lines";
import { loadFrontMatter, type FrontMatterData } from "./read";
import { parseSafeYaml } from "./safe-yaml";
import { applyTextEdits, type TextEdit } from "./text-edit";

/** Values the properties panel writes: string, boolean, or a list of strings. */
export type FrontMatterValue = string | boolean | readonly string[];

export type FrontMatterEdit =
  /** Sets a field. Existing unknown fields and the order of other fields are kept. */
  | { readonly op: "set"; readonly key: string; readonly value: FrontMatterValue }
  /** Sets a date field as a quoted `YYYY-MM-DD` string. */
  | { readonly op: "set-date"; readonly key: string; readonly value: string }
  /** Omits a field from the front matter. Removing a field that does not exist does nothing. */
  | { readonly op: "remove"; readonly key: string };

export type FrontMatterUpdateResult =
  | {
      readonly ok: true;
      /** False when the edits do not change any value; `edits` is then empty. */
      readonly changed: boolean;
      /** Minimal text edits against the original text, ready for a version-checked WorkspaceEdit. */
      readonly edits: readonly TextEdit[];
      /** The original text with `edits` applied. */
      readonly text: string;
    }
  | { readonly ok: false; readonly issues: readonly FrontMatterIssue[] };

/**
 * Applies field edits to the front matter of a Markdown text using document-level YAML editing.
 *
 * - Only the lines of the front matter that change are replaced. The body, its line endings, and
 *   its trailing whitespace are never touched.
 * - Unknown keys, values, comments (where the YAML library retains them), and key order are kept.
 *   Formatting of the affected YAML region may be normalized, which the specification allows.
 * - A text without front matter gets a new block, using the line ending of the document.
 * - Invalid or unsupported YAML is never rewritten: the result is a failure with diagnostics.
 * - Strings that other YAML parsers would read as a different type (`yes`, `123`, `2026-01-01`,
 *   `null`, ...) are written quoted, so MkDocs and similar tools read the same value.
 * - The serialized YAML is parsed again and must equal the intended data; otherwise nothing is
 *   written.
 */
export function updateFrontMatter(
  text: string,
  edits: readonly FrontMatterEdit[],
): FrontMatterUpdateResult {
  const loaded = loadFrontMatter(text);
  if (loaded.status === "invalid") {
    return { ok: false, issues: loaded.issues };
  }

  const editIssues = validateEdits(edits);
  if (editIssues.length > 0) {
    return { ok: false, issues: editIssues };
  }

  const eol = loaded.status === "ok" ? loaded.block.eol : detectLineEnding(text);
  const document = loaded.status === "ok" ? loaded.document : parseSafeYaml("", 1).document;
  const before: FrontMatterData = loaded.status === "ok" ? loaded.data : {};

  for (const edit of edits) {
    applyEdit(document, edit);
  }
  dropEmptyMapping(document);

  const after = dataOf(document);
  if (isDeepStrictEqual(before, after)) {
    return { ok: true, changed: false, edits: [], text };
  }

  const yaml = serialize(document);
  const reparsed = parseSafeYaml(yaml, 1);
  if (reparsed.issues.length > 0 || !isDeepStrictEqual(dataOf(reparsed.document), after)) {
    return { ok: false, issues: [{ code: "roundtrip-mismatch" }] };
  }

  const newYaml = yaml.replaceAll("\n", eol);
  const edit: TextEdit =
    loaded.status === "ok"
      ? minimalEdit(
          loaded.block.contentStart,
          text.slice(loaded.block.contentStart, loaded.block.contentEnd),
          newYaml,
        )
      : insertionAtStart(text, eol, newYaml);

  return { ok: true, changed: true, edits: [edit], text: applyTextEdits(text, [edit]) };
}

function dataOf(document: Document): FrontMatterData {
  return (document.contents === null ? {} : document.toJS()) as FrontMatterData;
}

function isControlCharacter(character: string): boolean {
  const codePoint = character.codePointAt(0) ?? 0;
  return codePoint <= 0x1f || codePoint === 0x7f;
}

function validateEdits(edits: readonly FrontMatterEdit[]): FrontMatterIssue[] {
  const issues: FrontMatterIssue[] = [];
  for (const edit of edits) {
    if (edit.key === "" || Array.from(edit.key).some(isControlCharacter)) {
      issues.push({ code: "invalid-key" });
    }
    if (edit.op === "set-date" && !isCalendarDate(edit.value)) {
      issues.push({ code: "invalid-date", params: { expected: "YYYY-MM-DD" } });
    }
  }
  return issues;
}

/** Whether `value` is a real calendar date written as `YYYY-MM-DD`. */
export function isCalendarDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) {
    return false;
  }
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

function applyEdit(document: Document, edit: FrontMatterEdit): void {
  switch (edit.op) {
    case "remove":
      // Front matter without a mapping (empty or comments only) has nothing to remove, and the
      // YAML library throws when deleting from it.
      if (isMap(document.contents)) {
        document.delete(edit.key);
      }
      return;
    case "set-date":
      setDate(document, edit.key, edit.value);
      return;
    case "set":
      setValue(document, edit.key, edit.value);
      return;
  }
}

function setValue(document: Document, key: string, value: FrontMatterValue): void {
  const existing = document.get(key, true);

  if (typeof value === "string") {
    if (isScalar(existing) && typeof existing.value === "string") {
      // Reuse the node so quote style and a trailing comment are kept.
      existing.value = value;
      const type = stringType(value, existing.type);
      if (type !== undefined) {
        existing.type = type;
      }
      return;
    }
    replace(document, key, existing, createString(value));
  } else if (typeof value === "boolean") {
    if (isScalar(existing) && typeof existing.value === "boolean") {
      existing.value = value;
      return;
    }
    replace(document, key, existing, new Scalar(value));
  } else {
    const sequence = new YAMLSeq();
    for (const item of value) {
      sequence.items.push(createString(item));
    }
    if (isSeq(existing) && existing.flow !== undefined) {
      sequence.flow = existing.flow;
    }
    replace(document, key, existing, sequence);
  }
}

function setDate(document: Document, key: string, value: string): void {
  const existing = document.get(key, true);
  if (isScalar(existing) && typeof existing.value === "string") {
    existing.value = value;
    existing.type =
      existing.type === Scalar.QUOTE_SINGLE ? Scalar.QUOTE_SINGLE : Scalar.QUOTE_DOUBLE;
    return;
  }
  const scalar = new Scalar(value);
  scalar.type = Scalar.QUOTE_DOUBLE;
  replace(document, key, existing, scalar);
}

/** Replaces or adds a field with a new node, keeping the comments of the node it replaces. */
function replace(document: Document, key: string, existing: unknown, node: Scalar | YAMLSeq): void {
  if (isNode(existing)) {
    if (existing.comment !== undefined) {
      node.comment = existing.comment;
    }
    if (existing.commentBefore !== undefined) {
      node.commentBefore = existing.commentBefore;
    }
    if (existing.spaceBefore !== undefined) {
      node.spaceBefore = existing.spaceBefore;
    }
  }
  document.set(key, node);
}

function createString(value: string): Scalar<string> {
  const scalar = new Scalar(value);
  if (isAmbiguousPlainString(value)) {
    scalar.type = Scalar.QUOTE_DOUBLE;
  }
  return scalar;
}

function stringType(value: string, current: Scalar.Type | undefined): Scalar.Type | undefined {
  const plain = current === undefined || current === Scalar.PLAIN;
  return plain && isAmbiguousPlainString(value) ? Scalar.QUOTE_DOUBLE : current;
}

// Words that YAML 1.1 parsers (for example PyYAML, used by MkDocs) read as booleans or null.
const YAML_1_1_WORD =
  /^(?:y|Y|yes|Yes|YES|n|N|no|No|NO|true|True|TRUE|false|False|FALSE|on|On|ON|off|Off|OFF|null|Null|NULL|~)$/;
const NUMBER_LIKE =
  /^[-+]?(?:\d[\d_]*(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?$|^[-+]?0[xob][\da-fA-F_]+$|^[-+]?\.(?:inf|Inf|INF)$|^\.(?:nan|NaN|NAN)$/;
const SEXAGESIMAL = /^[-+]?\d+(?::[0-5]?\d)+(?:\.\d*)?$/;
const TIMESTAMP_LIKE = /^\d{4}-\d{1,2}-\d{1,2}(?:$|[Tt\s])/;

/**
 * Whether a string written without quotes could be read as another type or as another value by a
 * YAML parser. Such strings are quoted when this package writes them.
 */
export function isAmbiguousPlainString(value: string): boolean {
  return (
    value === "" ||
    value !== value.trim() ||
    YAML_1_1_WORD.test(value) ||
    NUMBER_LIKE.test(value) ||
    SEXAGESIMAL.test(value) ||
    TIMESTAMP_LIKE.test(value)
  );
}

/**
 * A mapping without entries would be written as `{}`. Front matter without fields is written as
 * an empty region instead, keeping comments of the document.
 */
function dropEmptyMapping(document: Document): void {
  const contents = document.contents;
  if (isMap(contents) && contents.items.length === 0) {
    const comments = [document.commentBefore, contents.commentBefore].filter(
      (comment): comment is string => typeof comment === "string" && comment !== "",
    );
    document.commentBefore = comments.length > 0 ? comments.join("\n") : null;
    document.contents = null;
  }
}

/**
 * Serializes the document with LF line endings. A document without a mapping is written as its
 * comments only: the YAML library would write an empty document as the word `null`.
 */
function serialize(document: Document): string {
  if (document.contents === null) {
    const comment = document.commentBefore;
    return typeof comment === "string" && comment !== ""
      ? `${comment
          .split("\n")
          .map((line) => `#${line}`)
          .join("\n")}\n`
      : "";
  }
  // Long strings are not folded, and flow lists keep the common `[a, b]` spelling so that fields
  // that were not edited are written back unchanged.
  return document.toString({ lineWidth: 0, indent: 2, flowCollectionPadding: false });
}

function insertionAtStart(text: string, eol: string, yaml: string): TextEdit {
  const offset = text.startsWith("\uFEFF") ? 1 : 0;
  return { start: offset, end: offset, newText: `---${eol}${yaml}---${eol}` };
}

/** Replaces only the lines between the common leading and trailing lines of old and new text. */
function minimalEdit(contentStart: number, oldText: string, newText: string): TextEdit {
  const oldLines = splitLines(oldText);
  const newLines = splitLines(newText);

  let prefix = 0;
  while (
    prefix < oldLines.length &&
    prefix < newLines.length &&
    oldLines[prefix] === newLines[prefix]
  ) {
    prefix++;
  }

  let suffix = 0;
  while (
    suffix < oldLines.length - prefix &&
    suffix < newLines.length - prefix &&
    oldLines[oldLines.length - 1 - suffix] === newLines[newLines.length - 1 - suffix]
  ) {
    suffix++;
  }

  const length = (lines: readonly string[]): number =>
    lines.reduce((total, line) => total + line.length, 0);
  return {
    start: contentStart + length(oldLines.slice(0, prefix)),
    end: contentStart + oldText.length - length(oldLines.slice(oldLines.length - suffix)),
    newText: newLines.slice(prefix, newLines.length - suffix).join(""),
  };
}

function splitLines(text: string): string[] {
  return text.match(/[^\n]*\n|[^\n]+$/g) ?? [];
}
