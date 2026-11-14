import type {
  CollectionChoice,
  PropertiesModel,
  PropertyField,
  PropertyValue,
  PropertyWidget,
} from "@lorequill/editor";
import { isCalendarDate, readFrontMatter, type FrontMatterIssue } from "@lorequill/markdown";
import type { Collection, CollectionField } from "@lorequill/profile";
import { expandDefault, matchingCollections } from "./collections";

export interface PropertiesInput {
  readonly collections: readonly Collection[];
  /** Path of the page relative to the content root. */
  readonly pagePath: string;
  readonly text: string;
  /** Collection chosen by the author when several match; ignored if it no longer matches. */
  readonly chosenCollection?: string;
  readonly describeIssue: (issue: FrontMatterIssue) => string;
}

/**
 * Builds the Properties view of a page (specification §6, §8): the fields of its collection with
 * their current values, missing required fields marked, and every other front matter key in a
 * generic view. Reading never changes anything; defaults are only offered, never applied.
 */
export function buildPropertiesModel(input: PropertiesInput): PropertiesModel {
  const read = readFrontMatter(input.text);
  if (read.status === "invalid") {
    return {
      status: "readonly",
      page: input.pagePath,
      problems: read.issues.map(input.describeIssue),
    };
  }
  const data = read.status === "ok" ? read.data : {};
  const matches = matchingCollections(input.collections, input.pagePath, data);
  const collection =
    matches.find(({ id }) => id === input.chosenCollection) ?? matches[0] ?? undefined;
  const definitions = collection?.fields ?? [];
  const definedKeys = new Set(definitions.map(({ key }) => key));

  const fields = definitions
    .filter(isVisible)
    .map((definition) => knownField(definition, data, input.pagePath));
  const unknown = Object.keys(data)
    .filter((key) => !definedKeys.has(key))
    .map((key) => unknownField(key, data[key]));

  return {
    status: "ok",
    page: input.pagePath,
    collections: matches.map(choiceOf),
    ...(collection ? { collection: collection.id } : {}),
    fields,
    unknown,
  };
}

/** A collection field the panel shows: every widget except `hidden`. */
type VisibleField = CollectionField & { readonly widget: PropertyWidget };

function isVisible(definition: CollectionField): definition is VisibleField {
  return definition.widget !== "hidden";
}

function choiceOf(collection: Collection): CollectionChoice {
  return { id: collection.id, label: collection.label ?? collection.id };
}

type Read = { readonly value?: PropertyValue; readonly widget: PropertyWidget } | undefined;

/** Reads `raw` for `widget`; `undefined` if the widget cannot edit it without changing its type. */
function readFor(widget: PropertyWidget, raw: unknown): Read {
  if (raw === undefined || raw === null) {
    return { widget };
  }
  switch (widget) {
    case "boolean":
      return typeof raw === "boolean" ? { widget, value: raw } : undefined;
    case "list":
      if (typeof raw === "string") {
        return { widget, value: [raw] };
      }
      return Array.isArray(raw) && raw.every((item) => typeof item === "string")
        ? { widget, value: raw }
        : undefined;
    case "date":
      if (typeof raw !== "string") {
        return undefined;
      }
      // A value that is not a date stays editable as text instead of being shown as empty.
      return isCalendarDate(raw) || raw === ""
        ? { widget, value: raw }
        : { widget: "string", value: raw };
    default:
      return typeof raw === "string" ? { widget, value: raw } : undefined;
  }
}

function isEmpty(value: PropertyValue | undefined): boolean {
  return value === undefined || value === "" || (Array.isArray(value) && value.length === 0);
}

/** A value the panel cannot edit, shown as JSON (numbers, mappings, nested lists). */
function rawText(value: unknown): string {
  return JSON.stringify(value);
}

function knownField(
  definition: VisibleField,
  data: Readonly<Record<string, unknown>>,
  pagePath: string,
): PropertyField {
  const present = Object.hasOwn(data, definition.key);
  const raw = data[definition.key];
  const read = readFor(definition.widget, raw);
  const required = definition.required ?? false;
  const defaultValue = present ? undefined : defaultOf(definition, pagePath);
  return {
    key: definition.key,
    label: definition.label ?? definition.key,
    widget: read?.widget ?? definition.widget,
    known: true,
    required,
    present,
    ...(read?.value === undefined ? {} : { value: read.value }),
    // A value of another type (for example a number) is there, so it is not missing.
    missing: required && read !== undefined && isEmpty(read.value),
    ...(definition.widget === "select" ? { options: definition.options } : {}),
    ...(defaultValue === undefined ? {} : { defaultValue }),
    editable: read !== undefined,
    ...(read === undefined ? { raw: rawText(raw) } : {}),
  };
}

function defaultOf(definition: VisibleField, pagePath: string): PropertyValue | undefined {
  const value = definition.default;
  if (typeof value === "string") {
    return expandDefault(value, pagePath);
  }
  if (Array.isArray(value)) {
    return value.map((item) => expandDefault(item, pagePath));
  }
  return value;
}

/** A key the collection does not define: edited with a widget that fits its current value. */
function unknownField(key: string, raw: unknown): PropertyField {
  let read: Read;
  if (raw === undefined || raw === null) {
    read = { widget: "string" };
  } else if (typeof raw === "boolean") {
    read = { widget: "boolean", value: raw };
  } else if (typeof raw === "string") {
    read = { widget: raw.includes("\n") ? "text" : "string", value: raw };
  } else if (Array.isArray(raw) && raw.every((item) => typeof item === "string")) {
    read = { widget: "list", value: raw };
  }
  return {
    key,
    label: key,
    widget: read?.widget ?? "string",
    known: false,
    required: false,
    present: true,
    ...(read?.value === undefined ? {} : { value: read.value }),
    missing: false,
    editable: read !== undefined,
    ...(read === undefined ? { raw: rawText(raw) } : {}),
  };
}
