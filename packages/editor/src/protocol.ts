/**
 * Messages between the extension (host) and the editor webview (specification §7). Positions are
 * 0-based lines and UTF-16 characters, like VS Code's, so line endings never shift offsets.
 *
 * Every incoming message is validated at runtime: the webview renders untrusted page content, so
 * the host must not trust its messages, and the webview must not trust malformed host messages
 * either (§15).
 */

export interface Position {
  readonly line: number;
  readonly character: number;
}

export interface TextChange {
  readonly from: Position;
  readonly to: Position;
  readonly text: string;
}

export interface EditorSettings {
  readonly fontFamily: string;
  readonly fontSize: number;
  readonly tabSize: number;
  readonly wordWrap: boolean;
  /** Maximum width of the text column in `Edit`, in pixels; 0 for none. */
  readonly maxTextWidth: number;
}

/** Texts of the toolbar and widgets, in the display language, sent by the host with `init`. */
export const EDITOR_LABEL_KEYS = [
  "toolbar",
  "undo",
  "redo",
  "bold",
  "italic",
  "strikethrough",
  "code",
  "heading1",
  "heading2",
  "heading3",
  "bullet",
  "numbered",
  "task",
  "quote",
  "codeBlock",
  "link",
  "table",
  "horizontalRule",
  "source",
  "save",
  "checkPages",
  "commit",
  "submit",
  "frontMatter",
  "tableHeader1",
  "tableHeader2",
  "tableTools",
  "tableInsertRowAbove",
  "tableInsertRowBelow",
  "tableDeleteRow",
  "tableInsertColumnLeft",
  "tableInsertColumnRight",
  "tableDeleteColumn",
  "tableMoveRowUp",
  "tableMoveRowDown",
  "tableMoveColumnLeft",
  "tableMoveColumnRight",
  "tableAlignLeft",
  "tableAlignCenter",
  "tableAlignRight",
  "tableFormat",
  "tableDelete",
  "viewModes",
  "viewEdit",
  "viewBoth",
  "viewPreview",
  "previewApproximation",
] as const;

export type EditorLabelKey = (typeof EDITOR_LABEL_KEYS)[number];
export type EditorLabels = Readonly<Record<EditorLabelKey, string>>;

export interface EditorDiagnostic {
  readonly from: Position;
  readonly to: Position;
  readonly severity: "error" | "warning" | "info";
  readonly message: string;
  readonly source?: string;
}

/** Commands the host forwards from VS Code to the active editor. */
export const TABLE_COMMANDS = [
  "tableInsertRowAbove",
  "tableInsertRowBelow",
  "tableDeleteRow",
  "tableInsertColumnLeft",
  "tableInsertColumnRight",
  "tableDeleteColumn",
  "tableMoveRowUp",
  "tableMoveRowDown",
  "tableMoveColumnLeft",
  "tableMoveColumnRight",
  "tableAlignLeft",
  "tableAlignCenter",
  "tableAlignRight",
  "tableFormat",
  "tableDelete",
] as const;
export type TableCommand = (typeof TABLE_COMMANDS)[number];
export type EditorCommand =
  "find" | "replace" | "viewEdit" | "viewBoth" | "viewPreview" | "insertLink" | TableCommand;
const EDITOR_COMMANDS: readonly string[] = [
  "insertLink",
  "find",
  "replace",
  "viewEdit",
  "viewBoth",
  "viewPreview",
  ...TABLE_COMMANDS,
];

/** Where the page lives, for the rendered preview (§8). */
export interface PageLocation {
  /** POSIX path of the page relative to its content root, without `.` or `..` segments. */
  readonly path: string;
  /** Webview URI of the content root, ending in `/`; images load only below it. */
  readonly resourceBase: string;
}

/** Host → webview. */
export type HostMessage =
  /** The complete document; resets the editor. Sent after `ready` and on resynchronization. */
  | {
      readonly type: "init";
      readonly version: number;
      readonly text: string;
      readonly settings: EditorSettings;
      readonly labels: EditorLabels;
      /** Absent for pages outside a content root: the preview then loads no images. */
      readonly page?: PageLocation;
    }
  /** Changes not made by this webview (undo, redo, other editors, properties panel, disk). */
  | { readonly type: "update"; readonly version: number; readonly changes: readonly TextChange[] }
  /** The edit `id` was applied; the document now has `version`. */
  | { readonly type: "ack"; readonly id: number; readonly version: number }
  /** The edit `id` was not applied because it was based on an outdated version. */
  | { readonly type: "reject"; readonly id: number }
  | { readonly type: "settings"; readonly settings: EditorSettings }
  | { readonly type: "diagnostics"; readonly diagnostics: readonly EditorDiagnostic[] }
  | { readonly type: "command"; readonly command: EditorCommand }
  /** Moves the cursor to the start of `line` and scrolls it to the top (outline navigation). */
  | { readonly type: "reveal"; readonly line: number }
  /** Send collected changes now and answer `flushed` with the same token (before save, undo). */
  | { readonly type: "flush"; readonly token: number }
  /** Insert Link: replace the selection with a link the author chose (§10). */
  | { readonly type: "insertLink"; readonly text: string; readonly destination: string }
  /** Answer to `complete`: link destinations or anchors, with the page title as detail. */
  | {
      readonly type: "completions";
      readonly id: number;
      readonly items: readonly CompletionItem[];
    };

/** A suggestion for a link destination: the text to insert and a description. */
export interface CompletionItem {
  readonly label: string;
  readonly detail?: string;
  /** Further texts the item is found by but that are not shown, such as page aliases. */
  readonly keywords?: readonly string[];
}

/** Host actions the webview toolbar can request. */
export type HostAction =
  "undo" | "redo" | "save" | "checkPages" | "commit" | "submit" | "openAsText" | "showProperties";
const HOST_ACTIONS: readonly string[] = [
  "undo",
  "redo",
  "save",
  "checkPages",
  "commit",
  "submit",
  "openAsText",
  "showProperties",
];

/** Webview → host. */
export type WebviewMessage =
  /** The webview is ready (again) and needs the complete document. */
  | { readonly type: "ready" }
  /**
   * Edits based on document `baseVersion`. All ranges refer to that version (they are applied
   * together, like one `WorkspaceEdit`), are sorted, and do not overlap.
   */
  | {
      readonly type: "edit";
      readonly id: number;
      readonly baseVersion: number;
      readonly changes: readonly TextChange[];
    }
  /** Collected changes were sent (answer to `flush`). */
  | { readonly type: "flushed"; readonly token: number }
  /** A toolbar button asks the host to act. */
  | { readonly type: "request"; readonly action: HostAction }
  /** Cursor position for the status bar. */
  | { readonly type: "selection"; readonly line: number; readonly character: number }
  /** Ctrl+click on a link: the destination as written in the page, resolved by the host. */
  | { readonly type: "openLink"; readonly target: string }
  /** Insert Link was invoked; the selected text is the proposed display text. */
  | { readonly type: "insertLink"; readonly selection: string }
  /**
   * Completion inside a link destination: pages, or with `anchorsOf` the anchors of that page
   * (as written in the destination before `#`; empty for the current page).
   */
  | { readonly type: "complete"; readonly id: number; readonly anchorsOf?: string };

/** Upper bounds for validated messages; larger messages are rejected. */
export const LIMITS = {
  maxTextLength: 32 * 1024 * 1024,
  maxChanges: 10_000,
  maxDiagnostics: 10_000,
  maxLinkTarget: 4096,
  maxCompletions: 5000,
  maxLinkText: 1000,
  maxKeywords: 100,
} as const;

type Shape = Record<string, unknown>;

function isShape(value: unknown): value is Shape {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isText(value: unknown): value is string {
  return typeof value === "string" && value.length <= LIMITS.maxTextLength;
}

function hasOnlyKeys(value: Shape, keys: readonly string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key));
}

function isPosition(value: unknown): value is Position {
  return (
    isShape(value) &&
    hasOnlyKeys(value, ["line", "character"]) &&
    isCount(value.line) &&
    isCount(value.character)
  );
}

function comparePositions(a: Position, b: Position): number {
  return a.line - b.line || a.character - b.character;
}

function isChange(value: unknown): value is TextChange {
  return (
    isShape(value) &&
    hasOnlyKeys(value, ["from", "to", "text"]) &&
    isPosition(value.from) &&
    isPosition(value.to) &&
    comparePositions(value.from, value.to) <= 0 &&
    isText(value.text)
  );
}

function isChangeList(value: unknown): value is readonly TextChange[] {
  return Array.isArray(value) && value.length <= LIMITS.maxChanges && value.every(isChange);
}

/** Sorted and non-overlapping, as required for the changes of one `edit`. */
function isSortedDisjoint(changes: readonly TextChange[]): boolean {
  for (let index = 1; index < changes.length; index++) {
    const previous = changes[index - 1];
    const current = changes[index];
    if (previous && current && comparePositions(previous.to, current.from) > 0) {
      return false;
    }
  }
  return true;
}

function isSettings(value: unknown): value is EditorSettings {
  return (
    isShape(value) &&
    hasOnlyKeys(value, ["fontFamily", "fontSize", "tabSize", "wordWrap", "maxTextWidth"]) &&
    typeof value.fontFamily === "string" &&
    value.fontFamily.length <= 1000 &&
    typeof value.fontSize === "number" &&
    value.fontSize > 0 &&
    value.fontSize <= 200 &&
    isCount(value.tabSize) &&
    value.tabSize >= 1 &&
    value.tabSize <= 16 &&
    typeof value.wordWrap === "boolean" &&
    isCount(value.maxTextWidth) &&
    value.maxTextWidth <= 10_000
  );
}

function isLabels(value: unknown): value is EditorLabels {
  return (
    isShape(value) &&
    hasOnlyKeys(value, EDITOR_LABEL_KEYS) &&
    EDITOR_LABEL_KEYS.every((key) => typeof value[key] === "string" && value[key].length <= 200)
  );
}

function isDiagnostic(value: unknown): value is EditorDiagnostic {
  return (
    isShape(value) &&
    hasOnlyKeys(value, ["from", "to", "severity", "message", "source"]) &&
    isPosition(value.from) &&
    isPosition(value.to) &&
    (value.severity === "error" || value.severity === "warning" || value.severity === "info") &&
    typeof value.message === "string" &&
    value.message.length <= 10_000 &&
    (value.source === undefined || (typeof value.source === "string" && value.source.length <= 200))
  );
}

/** A link destination is one line without control characters. */
function hasControlCharacter(text: string): boolean {
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    if (code < 0x20 || code === 0x7f) {
      return true;
    }
  }
  return false;
}

function isPageLocation(value: unknown): value is PageLocation {
  if (
    !isShape(value) ||
    !hasOnlyKeys(value, ["path", "resourceBase"]) ||
    typeof value.path !== "string" ||
    typeof value.resourceBase !== "string" ||
    value.path.length > LIMITS.maxLinkTarget ||
    value.resourceBase.length > LIMITS.maxLinkTarget ||
    hasControlCharacter(value.path) ||
    hasControlCharacter(value.resourceBase)
  ) {
    return false;
  }
  const segments = value.path.split("/");
  return (
    value.path !== "" &&
    !value.path.includes("\\") &&
    segments.every((segment) => segment !== "" && segment !== "." && segment !== "..") &&
    value.resourceBase.startsWith("https://") &&
    value.resourceBase.endsWith("/")
  );
}

function isCompletionItem(value: unknown): value is CompletionItem {
  return (
    isShape(value) &&
    hasOnlyKeys(value, ["label", "detail", "keywords"]) &&
    typeof value.label === "string" &&
    value.label.length <= LIMITS.maxLinkTarget &&
    (value.detail === undefined ||
      (typeof value.detail === "string" && value.detail.length <= LIMITS.maxLinkText)) &&
    (value.keywords === undefined ||
      (Array.isArray(value.keywords) &&
        value.keywords.length <= LIMITS.maxKeywords &&
        value.keywords.every(
          (keyword) => typeof keyword === "string" && keyword.length <= LIMITS.maxLinkText,
        )))
  );
}

/** Validates a message from the webview; `undefined` for anything malformed. */
export function parseWebviewMessage(value: unknown): WebviewMessage | undefined {
  if (!isShape(value)) {
    return undefined;
  }
  if (value.type === "ready" && hasOnlyKeys(value, ["type"])) {
    return { type: "ready" };
  }
  if (value.type === "flushed" && hasOnlyKeys(value, ["type", "token"]) && isCount(value.token)) {
    return { type: "flushed", token: value.token };
  }
  if (
    value.type === "request" &&
    hasOnlyKeys(value, ["type", "action"]) &&
    typeof value.action === "string" &&
    HOST_ACTIONS.includes(value.action)
  ) {
    return { type: "request", action: value.action as HostAction };
  }
  if (
    value.type === "selection" &&
    hasOnlyKeys(value, ["type", "line", "character"]) &&
    isCount(value.line) &&
    isCount(value.character)
  ) {
    return { type: "selection", line: value.line, character: value.character };
  }
  if (
    value.type === "openLink" &&
    hasOnlyKeys(value, ["type", "target"]) &&
    typeof value.target === "string" &&
    value.target.length > 0 &&
    value.target.length <= LIMITS.maxLinkTarget &&
    !hasControlCharacter(value.target)
  ) {
    return { type: "openLink", target: value.target };
  }
  if (
    value.type === "insertLink" &&
    hasOnlyKeys(value, ["type", "selection"]) &&
    typeof value.selection === "string" &&
    value.selection.length <= LIMITS.maxLinkText
  ) {
    return { type: "insertLink", selection: value.selection };
  }
  if (
    value.type === "complete" &&
    hasOnlyKeys(value, ["type", "id", "anchorsOf"]) &&
    isCount(value.id) &&
    (value.anchorsOf === undefined ||
      (typeof value.anchorsOf === "string" &&
        value.anchorsOf.length <= LIMITS.maxLinkTarget &&
        !hasControlCharacter(value.anchorsOf)))
  ) {
    return {
      type: "complete",
      id: value.id,
      ...(value.anchorsOf === undefined ? {} : { anchorsOf: value.anchorsOf }),
    };
  }
  if (
    value.type === "edit" &&
    hasOnlyKeys(value, ["type", "id", "baseVersion", "changes"]) &&
    isCount(value.id) &&
    isCount(value.baseVersion) &&
    isChangeList(value.changes) &&
    isSortedDisjoint(value.changes)
  ) {
    return { type: "edit", id: value.id, baseVersion: value.baseVersion, changes: value.changes };
  }
  return undefined;
}

/** Validates a message from the host; `undefined` for anything malformed. */
export function parseHostMessage(value: unknown): HostMessage | undefined {
  if (!isShape(value)) {
    return undefined;
  }
  switch (value.type) {
    case "init":
      return hasOnlyKeys(value, ["type", "version", "text", "settings", "labels", "page"]) &&
        isCount(value.version) &&
        isText(value.text) &&
        isSettings(value.settings) &&
        isLabels(value.labels) &&
        (value.page === undefined || isPageLocation(value.page))
        ? {
            type: "init",
            version: value.version,
            text: value.text,
            settings: value.settings,
            labels: value.labels,
            ...(value.page === undefined ? {} : { page: value.page }),
          }
        : undefined;
    case "update":
      return hasOnlyKeys(value, ["type", "version", "changes"]) &&
        isCount(value.version) &&
        isChangeList(value.changes)
        ? { type: "update", version: value.version, changes: value.changes }
        : undefined;
    case "ack":
      return hasOnlyKeys(value, ["type", "id", "version"]) &&
        isCount(value.id) &&
        isCount(value.version)
        ? { type: "ack", id: value.id, version: value.version }
        : undefined;
    case "reject":
      return hasOnlyKeys(value, ["type", "id"]) && isCount(value.id)
        ? { type: "reject", id: value.id }
        : undefined;
    case "settings":
      return hasOnlyKeys(value, ["type", "settings"]) && isSettings(value.settings)
        ? { type: "settings", settings: value.settings }
        : undefined;
    case "diagnostics":
      return hasOnlyKeys(value, ["type", "diagnostics"]) &&
        Array.isArray(value.diagnostics) &&
        value.diagnostics.length <= LIMITS.maxDiagnostics &&
        value.diagnostics.every(isDiagnostic)
        ? { type: "diagnostics", diagnostics: value.diagnostics }
        : undefined;
    case "flush":
      return hasOnlyKeys(value, ["type", "token"]) && isCount(value.token)
        ? { type: "flush", token: value.token }
        : undefined;
    case "reveal":
      return hasOnlyKeys(value, ["type", "line"]) && isCount(value.line)
        ? { type: "reveal", line: value.line }
        : undefined;
    case "insertLink":
      return hasOnlyKeys(value, ["type", "text", "destination"]) &&
        typeof value.text === "string" &&
        value.text.length <= LIMITS.maxLinkText &&
        typeof value.destination === "string" &&
        value.destination.length <= LIMITS.maxLinkTarget
        ? { type: "insertLink", text: value.text, destination: value.destination }
        : undefined;
    case "completions":
      return hasOnlyKeys(value, ["type", "id", "items"]) &&
        isCount(value.id) &&
        Array.isArray(value.items) &&
        value.items.length <= LIMITS.maxCompletions &&
        value.items.every(isCompletionItem)
        ? { type: "completions", id: value.id, items: value.items }
        : undefined;
    case "command":
      return hasOnlyKeys(value, ["type", "command"]) &&
        typeof value.command === "string" &&
        EDITOR_COMMANDS.includes(value.command)
        ? { type: "command", command: value.command as EditorCommand }
        : undefined;
    default:
      return undefined;
  }
}
