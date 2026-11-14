import type { CheckRule } from "@lorequill/profile";

export type RuleName = CheckRule["rule"];

/** Stable finding codes. Each code has an English message template in {@link MESSAGES}. */
export type FindingCode =
  | "relative-links/empty"
  | "relative-links/absolute-path"
  | "relative-links/unsupported-scheme"
  | "relative-links/outside-content-root"
  | "relative-links/backslash"
  | "relative-links/malformed-encoding"
  | "relative-links/missing-target"
  | "relative-links/target-is-directory"
  | "relative-links/target-outside-content-root"
  | "relative-links/unsupported-target"
  | "relative-links/target-is-draft"
  | "relative-links/missing-anchor"
  | "forbidden-text/found"
  | "unique-field/duplicate"
  | "unique-field/not-scalar"
  | "allow-values/not-allowed"
  | "field-format/missing"
  | "field-format/invalid"
  | "reference-field/missing"
  | "reference-field/unknown"
  | "reference-field/self"
  | "reference-field/not-scalar"
  | "front-matter/invalid";

export type FindingParams = Readonly<Record<string, string | number>>;

/**
 * One check finding (specification §3 and §11). All findings are errors in profile version 1 and
 * block Commit. Paths are POSIX paths relative to the repository root.
 */
export interface Finding {
  /** The `id` of the check in the profile. */
  readonly ruleId: string;
  readonly rule: RuleName;
  readonly severity: "error";
  readonly code: FindingCode;
  readonly params: FindingParams;
  /** English message; editors may localize from `code` and `params` instead. */
  readonly message: string;
  readonly path: string;
  /** 1-based. */
  readonly line: number;
  /** 1-based, when the finding has a precise column. */
  readonly column?: number;
  /** 1-based end line of the reported text, when known. */
  readonly endLine?: number;
  /** 1-based column after the reported text, when known. */
  readonly endColumn?: number;
}

export const MESSAGES: Readonly<Record<FindingCode, string>> = {
  "relative-links/empty": "Link destination is empty.",
  "relative-links/absolute-path":
    'Link "{destination}" is an absolute path; use a path relative to this page.',
  "relative-links/unsupported-scheme": 'Link "{destination}" uses an unsupported scheme.',
  "relative-links/outside-content-root": 'Link "{destination}" leaves the content root.',
  "relative-links/backslash": 'Link "{destination}" contains a backslash; use "/" instead.',
  "relative-links/malformed-encoding": 'Link "{destination}" has invalid percent-encoding.',
  "relative-links/missing-target": 'Link target "{target}" does not exist.',
  "relative-links/target-is-directory": 'Link target "{target}" is a directory, not a file.',
  "relative-links/target-outside-content-root":
    'Link target "{target}" resolves outside the content root.',
  "relative-links/unsupported-target": 'Link target "{target}" is not a regular file.',
  "relative-links/target-is-draft":
    'Link target "{target}" is a draft and is not published; link to it only from other drafts.',
  "relative-links/missing-anchor": 'Anchor "#{anchor}" does not exist in "{target}".',
  "forbidden-text/found": 'Forbidden text "{text}" found.',
  "unique-field/duplicate": 'Value "{value}" of "{field}" is already used in "{first}".',
  "unique-field/not-scalar": 'Field "{field}" must be a single value to be checked for uniqueness.',
  "allow-values/not-allowed":
    'Value "{value}" after "{marker}" is not allowed; allowed: {allowed}.',
  "field-format/missing": 'Field "{field}" is required here.',
  "field-format/invalid":
    'Value "{value}" of "{field}" must look like {expected} (prefix, hyphen, digits).',
  "reference-field/missing": 'Field "{field}" is required here.',
  "reference-field/unknown": 'Value "{value}" of "{field}" matches the "{target}" of no page.',
  "reference-field/self": 'Value "{value}" of "{field}" refers to this page itself.',
  "reference-field/not-scalar":
    'Field "{field}" must be a single value or a list of values to refer to pages.',
  "front-matter/invalid": "The front matter cannot be read, so field checks cannot run.",
};

/** Fills a message template; unknown placeholders stay as they are. */
export function formatMessage(code: FindingCode, params: FindingParams): string {
  return MESSAGES[code].replace(/\{(\w+)\}/g, (placeholder, name: string) =>
    Object.hasOwn(params, name) ? String(params[name]) : placeholder,
  );
}

/** Deterministic order: path, line, column, check id, code, message. */
export function compareFindings(a: Finding, b: Finding): number {
  return (
    compareStrings(a.path, b.path) ||
    a.line - b.line ||
    (a.column ?? 0) - (b.column ?? 0) ||
    compareStrings(a.ruleId, b.ruleId) ||
    compareStrings(a.code, b.code) ||
    compareStrings(a.message, b.message)
  );
}

/** Code-unit order, independent of the locale of the machine. */
export function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
