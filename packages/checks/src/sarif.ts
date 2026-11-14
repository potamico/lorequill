import type { Profile } from "@lorequill/profile";
import type { CheckResult } from "./engine";

const RULE_DESCRIPTIONS: Readonly<Record<string, string>> = {
  "forbidden-text": "Pages must not contain a forbidden literal text.",
  "unique-field": "A front matter field must have a unique value across pages.",
  "allow-values": "The value after a marker must be one of the allowed values.",
  "relative-links": "Links must point to existing files inside the content root.",
  "field-format": "A front matter field must have the form PREFIX-digits.",
  "reference-field": "A front matter field must refer to other pages by their identifying field.",
};

/**
 * SARIF 2.1.0 report for code scanning hosts (specification §11 and §14). One SARIF rule per check
 * of the profile; locations are relative to the repository root (`%SRCROOT%`). The output is
 * deterministic for a given result and profile.
 */
export function formatSarif(result: CheckResult, profile: Profile): string {
  const checks = profile.checks?.rules ?? [];
  const ruleIndex = new Map(checks.map((check, index) => [check.id, index]));
  const sarif = {
    $schema: "https://json.schemastore.org/sarif-2.1.0.json",
    version: "2.1.0",
    runs: [
      {
        tool: {
          driver: {
            name: "Lorequill",
            semanticVersion: result.engineVersion,
            rules: checks.map((check) => ({
              id: check.id,
              name: check.rule,
              shortDescription: { text: RULE_DESCRIPTIONS[check.rule] ?? check.rule },
              defaultConfiguration: { level: "error" },
            })),
          },
        },
        invocations: [
          {
            executionSuccessful: result.status !== "error",
            ...(result.error
              ? {
                  toolExecutionNotifications: [
                    {
                      level: "error",
                      message: { text: `Check incomplete: ${result.error.code}` },
                    },
                  ],
                }
              : {}),
          },
        ],
        results: result.findings.map((finding) => ({
          ruleId: finding.ruleId,
          ...(ruleIndex.has(finding.ruleId) ? { ruleIndex: ruleIndex.get(finding.ruleId) } : {}),
          level: "error",
          message: { text: finding.message },
          locations: [
            {
              physicalLocation: {
                artifactLocation: { uri: encodeUri(finding.path), uriBaseId: "%SRCROOT%" },
                region: {
                  startLine: finding.line,
                  ...(finding.column === undefined ? {} : { startColumn: finding.column }),
                  ...(finding.endLine === undefined ? {} : { endLine: finding.endLine }),
                  ...(finding.endColumn === undefined ? {} : { endColumn: finding.endColumn }),
                },
              },
            },
          ],
          properties: { code: finding.code },
        })),
        properties: { snapshotId: result.snapshotId },
      },
    ],
  };
  return `${JSON.stringify(sarif, null, 2)}\n`;
}

/** Percent-encodes a POSIX path for a SARIF URI reference, keeping `/`. */
function encodeUri(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/");
}
