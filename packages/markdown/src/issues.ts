/**
 * Stable diagnostic codes for front matter. Each code is also the English key of a message in the
 * translation catalogs of user interfaces; this package never produces localized text.
 */
export type FrontMatterIssueCode =
  // Reading
  | "yaml-syntax"
  | "yaml-duplicate-key"
  | "yaml-unsupported-construct"
  | "front-matter-not-a-mapping"
  // Updating
  | "invalid-key"
  | "invalid-date"
  | "roundtrip-mismatch";

export interface FrontMatterIssue {
  readonly code: FrontMatterIssueCode;
  /** 1-based line in the complete Markdown file, when known. */
  readonly line?: number;
  /** 1-based column, when known. */
  readonly column?: number;
  /** Values for message placeholders. Never contains front matter values. */
  readonly params?: Readonly<Record<string, string | number>>;
}
