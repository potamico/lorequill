import type { PropertiesModel, PropertyField, PropertyValue } from "@lorequill/editor";
import { isCalendarDate, type FrontMatterEdit } from "@lorequill/markdown";

export type PropertyRequest =
  | { readonly type: "set"; readonly key: string; readonly value: PropertyValue }
  | { readonly type: "insertDefault"; readonly key: string };

export type PlannedEdit =
  | { readonly ok: true; readonly edits: readonly FrontMatterEdit[] }
  | {
      readonly ok: false;
      /** `stale`: the field is no longer offered (the page changed); otherwise a rejected value. */
      readonly reason: "stale" | "not-editable" | "invalid-value";
    };

/**
 * Turns a request of the Properties view into front matter edits, checked against the model of
 * the current document text (specification §6, §8):
 *
 * - Only fields the model offers and can edit are written, with values that fit their widget.
 * - Clearing an optional known field omits it; required and unknown fields keep an empty value.
 * - A date is written as a quoted `YYYY-MM-DD` string, a boolean as a YAML boolean.
 * - A default is inserted only on explicit request and only into a missing field.
 */
export function planPropertyEdit(model: PropertiesModel, request: PropertyRequest): PlannedEdit {
  if (model.status !== "ok") {
    return { ok: false, reason: "stale" };
  }
  const field = [...model.fields, ...model.unknown].find(({ key }) => key === request.key);
  if (!field) {
    return { ok: false, reason: "stale" };
  }
  if (!field.editable) {
    return { ok: false, reason: "not-editable" };
  }
  if (request.type === "insertDefault") {
    if (field.present || field.defaultValue === undefined) {
      return { ok: false, reason: "stale" };
    }
    return planSet(field, field.defaultValue);
  }
  return planSet(field, request.value);
}

function planSet(field: PropertyField, value: PropertyValue): PlannedEdit {
  const key = field.key;
  const clear = (empty: PropertyValue): PlannedEdit =>
    field.known && !field.required
      ? { ok: true, edits: [{ op: "remove", key }] }
      : { ok: true, edits: [{ op: "set", key, value: empty }] };

  switch (field.widget) {
    case "boolean":
      return typeof value === "boolean"
        ? { ok: true, edits: [{ op: "set", key, value }] }
        : { ok: false, reason: "invalid-value" };
    case "list": {
      if (!Array.isArray(value)) {
        return { ok: false, reason: "invalid-value" };
      }
      const items = (value as readonly string[])
        .map((item) => item.trim())
        .filter((item) => item !== "");
      if (items.some((item) => /[\r\n]/.test(item))) {
        return { ok: false, reason: "invalid-value" };
      }
      return items.length === 0
        ? clear([])
        : { ok: true, edits: [{ op: "set", key, value: items }] };
    }
    case "text":
      if (typeof value !== "string") {
        return { ok: false, reason: "invalid-value" };
      }
      return value.trim() === ""
        ? clear("")
        : { ok: true, edits: [{ op: "set", key, value: value.replace(/\r\n?/g, "\n") }] };
    case "date":
      if (typeof value !== "string") {
        return { ok: false, reason: "invalid-value" };
      }
      if (value === "") {
        return clear("");
      }
      return isCalendarDate(value)
        ? { ok: true, edits: [{ op: "set-date", key, value }] }
        : { ok: false, reason: "invalid-value" };
    case "select":
      if (typeof value !== "string") {
        return { ok: false, reason: "invalid-value" };
      }
      if (value === "") {
        return clear("");
      }
      // The current value stays selectable even if the profile no longer lists it.
      return field.options?.includes(value) || value === field.value
        ? { ok: true, edits: [{ op: "set", key, value }] }
        : { ok: false, reason: "invalid-value" };
    case "string":
      if (typeof value !== "string" || /[\r\n]/.test(value)) {
        return { ok: false, reason: "invalid-value" };
      }
      return value.trim() === "" ? clear("") : { ok: true, edits: [{ op: "set", key, value }] };
  }
}
