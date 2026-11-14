import { readFrontMatterField, type FrontMatterFieldResult } from "@lorequill/markdown";
import type { FieldFormatRule, UniqueFieldRule, WhenFilter } from "@lorequill/profile";
import type { Page, RuleContext } from "../context";

/**
 * Normalization for `unique-field` (decision D10): the scalar as text, Unicode NFC, trimmed,
 * whitespace runs collapsed, and lower-cased independent of locale. `BOK-1`, `bok-1`, and
 * ` BOK-1 ` are therefore duplicates.
 */
export function normalizeUniqueValue(value: string | number | boolean): string {
  return String(value).normalize("NFC").trim().replace(/\s+/g, " ").toLowerCase();
}

export function isScalar(value: unknown): value is string | number | boolean {
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean";
}

/**
 * Reads a field and reports unreadable front matter once per page and rule. Returns `undefined`
 * when the field is missing or the front matter is invalid.
 */
export function readField(
  page: Page,
  field: string,
  context: RuleContext,
): Extract<FrontMatterFieldResult, { status: "ok" }> | "missing" | undefined {
  const result = readFrontMatterField(page.text, field);
  if (result.status === "invalid") {
    context.report({
      code: "front-matter/invalid",
      params: {},
      path: page.path,
      line: result.line,
    });
    return undefined;
  }
  return result.status === "missing" ? "missing" : result;
}

/**
 * Whether a page is in the scope of a `when` filter: without one every page is; with one, pages
 * whose `when.field` is a scalar listed in `when.in`. Unreadable front matter is reported and
 * leaves the page out.
 */
export function matchesWhen(
  page: Page,
  when: WhenFilter | undefined,
  context: RuleContext,
): boolean {
  if (!when) {
    return true;
  }
  const filter = readField(page, when.field, context);
  return (
    filter !== undefined &&
    filter !== "missing" &&
    isScalar(filter.value) &&
    when.in.includes(String(filter.value))
  );
}

/**
 * `unique-field`: non-empty scalar values of a front matter field must be unique across included
 * pages after normalization. Every duplicate is reported on the later page (in path order) and
 * names the first page with that value. Lists and mappings are reported as not scalar; missing,
 * null, and empty values are ignored.
 */
export async function checkUniqueField(rule: UniqueFieldRule, context: RuleContext): Promise<void> {
  const first = new Map<string, string>();
  for (const page of context.pages) {
    await context.checkpoint();
    const field = readField(page, rule.field, context);
    if (field === undefined || field === "missing" || field.value === null) {
      continue;
    }
    if (!isScalar(field.value)) {
      context.report({
        code: "unique-field/not-scalar",
        params: { field: rule.field },
        path: page.path,
        line: field.line,
      });
      continue;
    }
    const normalized = normalizeUniqueValue(field.value);
    if (normalized === "") {
      continue;
    }
    const firstPath = first.get(normalized);
    if (firstPath === undefined) {
      first.set(normalized, page.path);
    } else {
      context.report({
        code: "unique-field/duplicate",
        params: {
          field: rule.field,
          value: String(field.value),
          first: context.repositoryPath(firstPath),
        },
        path: page.path,
        line: field.line,
      });
    }
  }
}

/**
 * `field-format`: on every included page in scope, the field must be a string of the form
 * `<PREFIX>-<digits>` with one of the configured prefixes (case-sensitive). Without `when`, every
 * page is in scope; with `when`, pages whose `when.field` value is one of `when.in`.
 */
export async function checkFieldFormat(rule: FieldFormatRule, context: RuleContext): Promise<void> {
  const pattern = new RegExp(`^(?:${rule.prefixes.join("|")})-[0-9]+$`);
  const expected = rule.prefixes.map((prefix) => `${prefix}-123`).join(" or ");

  for (const page of context.pages) {
    await context.checkpoint();
    if (!matchesWhen(page, rule.when, context)) {
      continue;
    }
    const field = readField(page, rule.field, context);
    if (field === undefined) {
      continue;
    }
    if (field === "missing" || field.value === null || field.value === "") {
      context.report({
        code: "field-format/missing",
        params: { field: rule.field },
        path: page.path,
        line: field === "missing" ? 1 : field.line,
      });
      continue;
    }
    const value = isScalar(field.value) ? String(field.value) : JSON.stringify(field.value);
    if (typeof field.value !== "string" || !pattern.test(field.value)) {
      context.report({
        code: "field-format/invalid",
        params: { field: rule.field, value, expected },
        path: page.path,
        line: field.line,
      });
    }
  }
}
