/* eslint-disable */
// This file is generated from schema/profile.schema.json by scripts/generate-types.mjs.
// Do not edit it by hand. Run `npm run generate:types --workspace @lorequill/profile`.

/**
 * Relative POSIX directory inside the repository: no absolute paths, no '..' segments, no drive letters, no backslashes. A single '.' selects the repository root.
 */
export type RelativeDirectory = string;
/**
 * Glob relative to the content root. Absolute patterns and '..' segments are rejected.
 */
export type GlobPattern = string;
/**
 * Git branch name. Rejects names that Git forbids and names that could be mistaken for command-line options.
 */
export type BranchName = string;
export type CheckRule =
  ForbiddenTextRule | UniqueFieldRule | AllowValuesRule | RelativeLinksRule | FieldFormatRule | ReferenceFieldRule;
/**
 * Stable identifier for check rules and collections.
 */
export type Identifier = string;
/**
 * Front matter key.
 */
export type FieldKey = string;
export type ShortText = string;
/**
 * Directory relative to the content root. The only supported placeholder is the whole segment {domain}.
 */
export type CollectionFolder = string;
export type CollectionField = TextLikeField | BooleanField | ListField | SelectField;

/**
 * Lorequill repository profile, version 1 (.lorequill/config.yaml). The schema is closed: unknown keys and unknown rules are rejected.
 */
export interface Profile {
  /**
   * Profile format version. Only version 1 is supported.
   */
  version: 1;
  /**
   * Interface locale for this repository, for example de-CH.
   */
  locale?: string;
  content: ContentSettings;
  review?: ReviewSettings;
  checks?: ChecksSettings;
  site?: SiteSettings;
  /**
   * @maxItems 100
   */
  collections?: Collection[];
}
export interface ContentSettings {
  root: RelativeDirectory;
  /**
   * @minItems 1
   * @maxItems 100
   */
  include: [GlobPattern, ...GlobPattern[]];
  /**
   * @maxItems 100
   */
  exclude?: GlobPattern[];
  /**
   * Drafts: files that are checked like other pages but not published. relative-links reports links from published pages to them.
   *
   * @maxItems 100
   */
  drafts?: GlobPattern[];
}
export interface ReviewSettings {
  base_branch: BranchName;
}
export interface ChecksSettings {
  /**
   * Check engine version that CI runs, as pinned in the workflow. The editor shows a notice when its own engine version differs.
   */
  engine_version?: string;
  /**
   * Single run-level timeout for an entire check run. Defaults to 30 when omitted.
   */
  timeout_seconds?: number;
  /**
   * @maxItems 100
   */
  rules?: CheckRule[];
}
export interface ForbiddenTextRule {
  id: Identifier;
  rule: "forbidden-text";
  /**
   * Literal, non-empty substring. Never interpreted as a regular expression.
   */
  text: string;
}
export interface UniqueFieldRule {
  id: Identifier;
  rule: "unique-field";
  field: FieldKey;
}
export interface AllowValuesRule {
  id: Identifier;
  rule: "allow-values";
  marker: ShortText;
  /**
   * @minItems 1
   * @maxItems 200
   */
  values: [ShortText, ...ShortText[]];
}
export interface RelativeLinksRule {
  id: Identifier;
  rule: "relative-links";
  anchors?: boolean;
  slugify?: "unicode" | "ascii";
}
export interface FieldFormatRule {
  id: Identifier;
  rule: "field-format";
  field: FieldKey;
  /**
   * @minItems 1
   * @maxItems 50
   */
  prefixes: [string, ...string[]];
  when?: WhenFilter;
}
export interface WhenFilter {
  field: FieldKey;
  /**
   * @minItems 1
   * @maxItems 200
   */
  in: [ShortText, ...ShortText[]];
}
/**
 * The field refers to other pages: each value (a value or a list of values) must equal the target field of another included page, compared like unique-field. With required, the field must be present on the pages in scope.
 */
export interface ReferenceFieldRule {
  id: Identifier;
  rule: "reference-field";
  field: FieldKey;
  target: FieldKey;
  required?: boolean;
  when?: WhenFilter;
}
/**
 * The published site built from the content, for stable links to pages.
 */
export interface SiteSettings {
  /**
   * Absolute http or https URL of the published site, ending with a slash.
   */
  url?: string;
  stable_links?: StableLinks;
}
/**
 * Addresses that stay the same when a page moves: the site build redirects each one to the page whose front matter field has that value.
 */
export interface StableLinks {
  field: FieldKey;
  /**
   * Path below the site URL with exactly one {value} placeholder, for example id/{value}/. No leading slash and no '.' or '..' segments.
   */
  path: string;
}
export interface Collection {
  id: Identifier;
  label?: ShortText;
  folder: CollectionFolder;
  match?: CollectionMatch;
  template?: string;
  /**
   * @maxItems 100
   */
  fields?: CollectionField[];
}
export interface CollectionMatch {
  field: FieldKey;
  equals: ShortText;
}
/**
 * Widgets string, text, date, and hidden. A date default is stored as a quoted YYYY-MM-DD string.
 */
export interface TextLikeField {
  key: FieldKey;
  label?: ShortText;
  widget: "string" | "text" | "date" | "hidden";
  required?: boolean;
  default?: string;
}
export interface BooleanField {
  key: FieldKey;
  label?: ShortText;
  widget: "boolean";
  required?: boolean;
  default?: boolean;
}
export interface ListField {
  key: FieldKey;
  label?: ShortText;
  widget: "list";
  required?: boolean;
  /**
   * @maxItems 200
   */
  default?: ShortText[];
}
export interface SelectField {
  key: FieldKey;
  label?: ShortText;
  widget: "select";
  required?: boolean;
  /**
   * @minItems 1
   * @maxItems 200
   */
  options: [ShortText, ...ShortText[]];
  default?: ShortText;
}
