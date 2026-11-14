import type { Profile } from "./generated/profile";

/**
 * Stable issue codes. Each code is also the English key of a message in the translation catalogs
 * that user interfaces maintain; this package never produces localized text.
 */
export type ProfileIssueCode =
  // Reading the profile file
  | "profile-not-found"
  | "profile-not-a-file"
  | "profile-outside-workspace"
  | "profile-too-large"
  | "profile-invalid-encoding"
  | "profile-unreadable"
  // YAML level
  | "profile-empty"
  | "yaml-syntax"
  | "yaml-duplicate-key"
  | "yaml-unsupported-construct"
  // Schema level
  | "unsupported-version"
  | "missing-key"
  | "unknown-key"
  | "unknown-rule"
  | "unknown-widget"
  | "invalid-type"
  | "invalid-value"
  // Cross-reference level
  | "duplicate-id"
  | "duplicate-field-key"
  | "invalid-default";

export type ProfileIssueParams = Readonly<Record<string, string | number>>;

export interface ProfileIssue {
  readonly code: ProfileIssueCode;
  /** JSON Pointer to the offending location in the profile; empty for the whole document. */
  readonly path: string;
  /** 1-based line in the YAML source, when known. */
  readonly line?: number;
  /** 1-based column in the YAML source, when known. */
  readonly column?: number;
  /** Values for message placeholders, for example `{ key: "argv" }`. */
  readonly params?: ProfileIssueParams;
}

export type ProfileResult =
  | { readonly ok: true; readonly profile: Profile }
  | { readonly ok: false; readonly issues: readonly ProfileIssue[] };
