import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { checkRepository, MESSAGES, type RepositoryCheck } from "../../src";

const SAMPLES = resolve(import.meta.dirname, "../../../../samples");
const SCHEMA = resolve(import.meta.dirname, "../../../profile/schema/profile.schema.json");

/** The `const` and `enum` values of every `rule` and `widget` property in the profile schema. */
function schemaNames(property: "rule" | "widget"): string[] {
  const names = new Set<string>();
  const walk = (node: unknown): void => {
    if (typeof node !== "object" || node === null) {
      return;
    }
    for (const [key, value] of Object.entries(node)) {
      if (key === property && typeof value === "object" && value !== null) {
        const { const: single, enum: many } = value as { const?: string; enum?: string[] };
        [single, ...(many ?? [])].forEach((name) => name !== undefined && names.add(name));
      }
      walk(value);
    }
  };
  walk(JSON.parse(readFileSync(SCHEMA, "utf8")));
  return [...names].sort();
}

function checked(check: RepositoryCheck): Extract<RepositoryCheck, { kind: "checked" }> {
  if (check.kind !== "checked") {
    expect.fail(`sample not checked: ${JSON.stringify(check)}`);
  }
  return check;
}

describe("samples/demo, the showcase", () => {
  it("passes every check", async () => {
    const { result } = checked(await checkRepository(resolve(SAMPLES, "demo")));
    expect(result.findings).toEqual([]);
    expect(result.status).toBe("passed");
    expect(result.pagesChecked).toBeGreaterThanOrEqual(16);
  });

  it("uses every check rule and every field widget of the profile schema", async () => {
    const { profile } = checked(await checkRepository(resolve(SAMPLES, "demo")));
    const rules = new Set(profile.checks?.rules?.map(({ rule }) => rule));
    const widgets = new Set(
      profile.collections?.flatMap(({ fields }) => fields?.map(({ widget }) => widget)),
    );
    expect([...rules].sort()).toEqual(schemaNames("rule"));
    expect([...widgets].sort()).toEqual(schemaNames("widget"));
  });
});

describe("samples/findings, the deliberate errors", () => {
  it("reports exactly the documented findings", async () => {
    const { result } = checked(await checkRepository(resolve(SAMPLES, "findings")));
    expect(result.status).toBe("failed");
    expect(
      result.findings.map(
        ({ path, line, ruleId, code }) => `${path}:${String(line)} ${ruleId} ${code}`,
      ),
    ).toEqual([
      "docs/decisions/no-id.md:1 decision-ids field-format/missing",
      "docs/decisions/wrong-id.md:4 decision-ids field-format/invalid",
      "docs/forbidden-text.md:3 wikilinks forbidden-text/found",
      "docs/forbidden-text.md:5 wikilinks forbidden-text/found",
      "docs/front-matter.md:3 decision-ids front-matter/invalid",
      "docs/front-matter.md:3 successors front-matter/invalid",
      "docs/front-matter.md:3 unique-ids front-matter/invalid",
      "docs/id-b.md:3 unique-ids unique-field/duplicate",
      "docs/id-list.md:3 unique-ids unique-field/not-scalar",
      "docs/links.md:3 links relative-links/missing-target",
      "docs/links.md:4 links relative-links/missing-anchor",
      "docs/links.md:5 links relative-links/outside-content-root",
      "docs/links.md:6 links relative-links/absolute-path",
      "docs/links.md:7 links relative-links/target-is-directory",
      "docs/links.md:8 links relative-links/backslash",
      "docs/links.md:9 links relative-links/unsupported-scheme",
      "docs/links.md:10 links relative-links/empty",
      "docs/links.md:11 links relative-links/malformed-encoding",
      "docs/links.md:12 links relative-links/target-is-draft",
      "docs/links.md:14 links relative-links/missing-target",
      "docs/retired-nested.md:5 successors reference-field/not-scalar",
      "docs/retired-no-successor.md:1 successors reference-field/missing",
      "docs/retired-self.md:5 successors reference-field/self",
      "docs/retired-unknown.md:5 successors reference-field/unknown",
      "docs/values.md:5 relations allow-values/not-allowed",
      "docs/values.md:7 relations allow-values/not-allowed",
    ]);
  });

  it("shows every finding code that a checkout can produce", async () => {
    const { result } = checked(await checkRepository(resolve(SAMPLES, "findings")));
    // A symbolic link out of the content root and a special file (such as a FIFO) cannot be
    // committed portably; the rule tests cover them.
    const needsSpecialFiles = [
      "relative-links/target-outside-content-root",
      "relative-links/unsupported-target",
    ];
    const shown = new Set(result.findings.map(({ code }) => code));
    expect([...shown].sort()).toEqual(
      Object.keys(MESSAGES)
        .filter((code) => !needsSpecialFiles.includes(code))
        .sort(),
    );
  });
});
