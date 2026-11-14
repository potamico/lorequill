/**
 * Messages between the extension (host) and the Properties view (`Properties`, specification
 * §8). The host owns the document and the profile: it sends a model of the front matter of the
 * active page and applies the author's changes as front matter edits (§7, §9). The webview never
 * sends text ranges, only "set this field to this value", so an edit cannot overwrite newer text.
 *
 * Messages from the webview are validated at runtime before the host acts on them (§15).
 */

/** Widgets of the panel. `hidden` fields are never sent to the webview. */
export type PropertyWidget = "string" | "text" | "select" | "list" | "boolean" | "date";

/** A value the panel can write: text, a YAML boolean, or a list of texts. */
export type PropertyValue = string | boolean | readonly string[];

export interface PropertyField {
  readonly key: string;
  /** Label from the profile, or the key. */
  readonly label: string;
  readonly widget: PropertyWidget;
  /** Defined by the collection; otherwise an unknown field shown in the generic view. */
  readonly known: boolean;
  readonly required: boolean;
  /** The key exists in the front matter. */
  readonly present: boolean;
  /** Current value for the widget; absent when the field is missing or empty (`key:`). */
  readonly value?: PropertyValue;
  /** Required and missing or empty: marked, but never blocks Save or Commit (§6). */
  readonly missing: boolean;
  /** Options of a `select`; a current value outside them is kept and shown as such. */
  readonly options?: readonly string[];
  /** Value the author can insert explicitly for a missing field (§6: defaults never apply silently). */
  readonly defaultValue?: PropertyValue;
  /**
   * False when the existing value has a type the widget cannot edit without changing it (for
   * example a number or a nested mapping); `raw` then shows it read-only.
   */
  readonly editable: boolean;
  readonly raw?: string;
}

export interface CollectionChoice {
  readonly id: string;
  readonly label: string;
}

export type PropertiesModel =
  /** No page of a Lorequill folder is active. */
  | { readonly status: "empty" }
  /** The front matter cannot be edited safely; source editing stays available (§9). */
  | {
      readonly status: "readonly";
      readonly page: string;
      /** Localized descriptions of the YAML problems. */
      readonly problems: readonly string[];
    }
  | {
      readonly status: "ok";
      /** Path of the page relative to the content root. */
      readonly page: string;
      /** Collections that match the page; several only if the profile is ambiguous for it. */
      readonly collections: readonly CollectionChoice[];
      /** The collection whose fields are shown; absent without a match (generic view). */
      readonly collection?: string;
      readonly fields: readonly PropertyField[];
      /** Front matter keys the collection does not define, in document order. */
      readonly unknown: readonly PropertyField[];
    };

/** Texts of the panel in the display language, sent once by the host. */
export const PROPERTIES_LABEL_KEYS = [
  "empty",
  "readonly",
  "openSource",
  "collection",
  "noCollection",
  "ambiguous",
  "unknownFields",
  "required",
  "missing",
  "insertDefault",
  "notEditable",
  "listHint",
  "selectNone",
  "invalidOption",
  "yes",
] as const;

export type PropertiesLabelKey = (typeof PROPERTIES_LABEL_KEYS)[number];
export type PropertiesLabels = Readonly<Record<PropertiesLabelKey, string>>;

/** Host → webview. */
export type PropertiesHostMessage =
  | { readonly type: "labels"; readonly labels: PropertiesLabels }
  | { readonly type: "model"; readonly model: PropertiesModel }
  /** An edit could not be applied; `message` is localized and shown in the panel. */
  | { readonly type: "notice"; readonly message: string };

/** Webview → host. */
export type PropertiesWebviewMessage =
  | { readonly type: "ready" }
  /** Sets a field. An empty value clears it: optional known fields are then omitted (§6). */
  | { readonly type: "set"; readonly key: string; readonly value: PropertyValue }
  /** Inserts the default of a missing field, the only way a default is applied here. */
  | { readonly type: "insertDefault"; readonly key: string }
  /** Shows the fields of another matching collection (display only, nothing is written). */
  | { readonly type: "chooseCollection"; readonly id: string }
  /** Opens the page as text at its front matter. */
  | { readonly type: "openSource" };

export const PROPERTIES_LIMITS = {
  maxKeyLength: 256,
  maxValueLength: 64 * 1024,
  maxListItems: 1000,
} as const;

type Shape = Readonly<Record<string, unknown>>;

function isShape(value: unknown): value is Shape {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Shape, keys: readonly string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key));
}

function isKey(value: unknown): value is string {
  return (
    typeof value === "string" && value !== "" && value.length <= PROPERTIES_LIMITS.maxKeyLength
  );
}

function isValueText(value: unknown): value is string {
  return typeof value === "string" && value.length <= PROPERTIES_LIMITS.maxValueLength;
}

function isPropertyValue(value: unknown): value is PropertyValue {
  if (typeof value === "boolean" || isValueText(value)) {
    return true;
  }
  return (
    Array.isArray(value) &&
    value.length <= PROPERTIES_LIMITS.maxListItems &&
    value.every((item) => isValueText(item))
  );
}

/** Validates a message from the Properties webview; `undefined` for anything malformed. */
export function parsePropertiesWebviewMessage(
  value: unknown,
): PropertiesWebviewMessage | undefined {
  if (!isShape(value)) {
    return undefined;
  }
  switch (value.type) {
    case "ready":
      return hasOnlyKeys(value, ["type"]) ? { type: "ready" } : undefined;
    case "openSource":
      return hasOnlyKeys(value, ["type"]) ? { type: "openSource" } : undefined;
    case "set":
      return hasOnlyKeys(value, ["type", "key", "value"]) &&
        isKey(value.key) &&
        isPropertyValue(value.value)
        ? { type: "set", key: value.key, value: value.value }
        : undefined;
    case "insertDefault":
      return hasOnlyKeys(value, ["type", "key"]) && isKey(value.key)
        ? { type: "insertDefault", key: value.key }
        : undefined;
    case "chooseCollection":
      return hasOnlyKeys(value, ["type", "id"]) && isKey(value.id)
        ? { type: "chooseCollection", id: value.id }
        : undefined;
    default:
      return undefined;
  }
}

/** Light validation of host messages in the webview: the type decides how the rest is read. */
export function parsePropertiesHostMessage(value: unknown): PropertiesHostMessage | undefined {
  if (!isShape(value)) {
    return undefined;
  }
  if (value.type === "labels" && isShape(value.labels)) {
    const labels = value.labels;
    return PROPERTIES_LABEL_KEYS.every((key) => typeof labels[key] === "string")
      ? { type: "labels", labels: labels as PropertiesLabels }
      : undefined;
  }
  if (value.type === "model" && isShape(value.model)) {
    const status = value.model.status;
    return status === "empty" || status === "readonly" || status === "ok"
      ? { type: "model", model: value.model as unknown as PropertiesModel }
      : undefined;
  }
  if (value.type === "notice" && typeof value.message === "string") {
    return { type: "notice", message: value.message };
  }
  return undefined;
}
