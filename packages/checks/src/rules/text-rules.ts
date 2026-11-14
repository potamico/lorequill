import type { AllowValuesRule, ForbiddenTextRule } from "@lorequill/profile";
import type { Page, RuleContext } from "../context";

/** Splits a text into lines (LF or CRLF) without their line endings. */
export function linesOf(text: string): string[] {
  return text.split(/\r?\n/);
}

/**
 * `forbidden-text`: a literal, case-sensitive substring that must not occur. One finding per
 * matching line, at the first occurrence. The whole file is checked, including front matter.
 */
export async function checkForbiddenText(
  rule: ForbiddenTextRule,
  context: RuleContext,
): Promise<void> {
  for (const page of context.pages) {
    await context.checkpoint();
    linesOf(page.text).forEach((line, index) => {
      const column = line.indexOf(rule.text);
      if (column !== -1) {
        context.report({
          code: "forbidden-text/found",
          params: { text: rule.text },
          path: page.path,
          line: index + 1,
          column: column + 1,
          endLine: index + 1,
          endColumn: column + 1 + rule.text.length,
        });
      }
    });
  }
}

/**
 * `allow-values`: on every line that contains `marker`, the trimmed text after its first
 * occurrence, with one surrounding pair of backticks removed, must be one of `values`. Values are
 * compared literally and case-sensitively.
 */
export async function checkAllowValues(rule: AllowValuesRule, context: RuleContext): Promise<void> {
  const allowed = new Set(rule.values);
  const allowedText = rule.values.join(", ");
  for (const page of context.pages) {
    await context.checkpoint();
    checkPageValues(page, rule, allowed, allowedText, context);
  }
}

function checkPageValues(
  page: Page,
  rule: AllowValuesRule,
  allowed: ReadonlySet<string>,
  allowedText: string,
  context: RuleContext,
): void {
  linesOf(page.text).forEach((line, index) => {
    const position = line.indexOf(rule.marker);
    if (position === -1) {
      return;
    }
    let value = line.slice(position + rule.marker.length).trim();
    if (value.length >= 2 && value.startsWith("`") && value.endsWith("`")) {
      value = value.slice(1, -1);
    }
    if (!allowed.has(value)) {
      context.report({
        code: "allow-values/not-allowed",
        params: { value, marker: rule.marker, allowed: allowedText },
        path: page.path,
        line: index + 1,
        column: position + 1,
        endLine: index + 1,
        endColumn: line.length + 1,
      });
    }
  });
}
