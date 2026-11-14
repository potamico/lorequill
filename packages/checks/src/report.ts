import type { CheckResult } from "./engine";

const ERROR_TEXT: Readonly<Record<string, string>> = {
  timeout: "the check run exceeded checks.timeout_seconds",
  cancelled: "the check run was cancelled",
  "too-many-files": "the content root has too many entries to list completely",
  "page-too-large": "a page exceeds the size limit",
  "too-many-findings": "the run stopped at the finding limit",
  unreadable: "a page could not be read",
};

/** Human-readable report: one line per finding, then a summary line. */
export function formatText(result: CheckResult): string {
  const lines = result.findings.map(
    (finding) =>
      `${finding.path}:${String(finding.line)}${finding.column === undefined ? "" : `:${String(finding.column)}`}: error ${finding.ruleId}: ${finding.message} [${finding.code}]`,
  );
  if (result.error) {
    const where = result.error.path === undefined ? "" : ` (${result.error.path})`;
    lines.push(
      `Check incomplete: ${ERROR_TEXT[result.error.code] ?? result.error.code}${where}. This is not a pass.`,
    );
  }
  const count = result.findings.length;
  lines.push(
    `Lorequill checks ${result.engineVersion}: ${String(result.pagesChecked)} pages, ${String(count)} ${count === 1 ? "finding" : "findings"}, ${result.status}, snapshot ${result.snapshotId}`,
  );
  return `${lines.join("\n")}\n`;
}

/** Machine-readable report with the complete result. */
export function formatJson(result: CheckResult): string {
  return `${JSON.stringify(result, null, 2)}\n`;
}
