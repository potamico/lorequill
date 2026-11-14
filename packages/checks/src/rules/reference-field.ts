import { readFrontMatterField } from "@lorequill/markdown";
import type { ReferenceFieldRule } from "@lorequill/profile";
import type { RuleContext } from "../context";
import { isScalar, matchesWhen, normalizeUniqueValue, readField } from "./field-rules";

/**
 * `reference-field`: the field refers to other pages by their `target` field, for example a
 * retired term's `replaced_by` to the `id` of its successor. On pages in scope (all, or those
 * matching `when`), each value of the field (a single value or a list) must equal the `target`
 * value of another included page, compared like `unique-field`. With `required`, a missing or
 * empty field is reported; otherwise pages without it are skipped.
 */
export async function checkReferenceField(
  rule: ReferenceFieldRule,
  context: RuleContext,
): Promise<void> {
  // Every page's target value, read without reporting: other rules report unreadable front
  // matter, and this rule reports it below for the pages it checks.
  const targets = new Map<string, Set<string>>();
  for (const page of context.pages) {
    await context.checkpoint();
    const target = readFrontMatterField(page.text, rule.target);
    if (target.status === "ok" && isScalar(target.value)) {
      const normalized = normalizeUniqueValue(target.value);
      if (normalized !== "") {
        const pages = targets.get(normalized) ?? new Set<string>();
        pages.add(page.path);
        targets.set(normalized, pages);
      }
    }
  }

  for (const page of context.pages) {
    await context.checkpoint();
    if (!matchesWhen(page, rule.when, context)) {
      continue;
    }
    const field = readField(page, rule.field, context);
    if (field === undefined) {
      continue;
    }
    const values =
      field === "missing" || field.value === null
        ? []
        : Array.isArray(field.value)
          ? (field.value as unknown[])
          : [field.value];
    const present = values.filter((value) => !(isScalar(value) && String(value).trim() === ""));
    if (present.length === 0) {
      if (rule.required) {
        context.report({
          code: "reference-field/missing",
          params: { field: rule.field },
          path: page.path,
          line: field === "missing" ? 1 : field.line,
        });
      }
      continue;
    }
    const line = field === "missing" ? 1 : field.line;
    for (const value of present) {
      if (!isScalar(value)) {
        context.report({
          code: "reference-field/not-scalar",
          params: { field: rule.field },
          path: page.path,
          line,
        });
        continue;
      }
      const pages = targets.get(normalizeUniqueValue(value));
      if (pages === undefined) {
        context.report({
          code: "reference-field/unknown",
          params: { field: rule.field, value: String(value), target: rule.target },
          path: page.path,
          line,
        });
      } else if (pages.size === 1 && pages.has(page.path)) {
        context.report({
          code: "reference-field/self",
          params: { field: rule.field, value: String(value) },
          path: page.path,
          line,
        });
      }
    }
  }
}
