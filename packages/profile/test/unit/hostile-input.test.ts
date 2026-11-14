import { describe, expect, it } from "vitest";
import { parseProfile } from "../../src/index";
import { BASE, fixture, issuesOf, lines, summarize } from "./helpers";

describe("hostile YAML input", () => {
  it("rejects JavaScript tags without evaluating anything", () => {
    const issues = issuesOf(fixture("hostile/js-tag.yaml"));
    expect(issues.map((issue) => issue.code)).toEqual(["yaml-unsupported-construct"]);
    expect(issues[0]?.params).toMatchObject({ construct: "tag" });
    expect(issues[0]).toMatchObject({ line: 3 });
  });

  it.each([
    ["!!python/object/apply:os.system ['id']"],
    ["!!binary aGVsbG8="],
    ["!!set { a, b }"],
    ["!!timestamp 2026-01-01"],
    ["!custom value"],
    ["!!str docs"],
  ])("rejects the tag %s", (value) => {
    const yaml = lines("version: 1", "content:", `  root: ${value}`, '  include: ["*.md"]');
    const issues = issuesOf(yaml);
    expect(issues.map((issue) => issue.code)).toEqual(["yaml-unsupported-construct"]);
    expect(issues[0]?.params).toMatchObject({ construct: "tag" });
  });

  it.each([["!!set {}"], ["!!omap []"], ["!!timestamp 2026-01-01"]])(
    "does not let the tagged value %s pass as an object section",
    (value) => {
      const issues = issuesOf(`${BASE}checks: ${value}\n`);
      expect(issues.map((issue) => issue.code)).toEqual(["yaml-unsupported-construct"]);
    },
  );

  it("rejects anchors and aliases", () => {
    const issues = issuesOf(fixture("hostile/alias-expansion.yaml"));
    expect(issues.map((issue) => issue.code)).toEqual([
      "yaml-unsupported-construct",
      "yaml-unsupported-construct",
    ]);
    expect(issues.map((issue) => issue.params?.construct)).toEqual(["anchor", "alias"]);
  });

  it("rejects duplicate keys", () => {
    const issues = issuesOf(fixture("hostile/duplicate-keys.yaml"));
    expect(issues.map((issue) => issue.code)).toEqual(["yaml-duplicate-key"]);
    expect(issues[0]).toMatchObject({ line: 4 });
  });

  it("rejects multiple documents", () => {
    const issues = issuesOf(`${BASE}---\n${BASE}`);
    expect(issues.map((issue) => issue.code)).toContain("yaml-syntax");
  });

  it("does not treat the merge key as a merge", () => {
    const yaml = lines("version: 1", "content:", "  <<: { root: docs }", '  include: ["*.md"]');
    // `<<` is an ordinary unknown key, and `root` is therefore missing.
    expect(summarize(issuesOf(yaml)).sort()).toEqual([
      "missing-key /content/root",
      "unknown-key /content/<<",
    ]);
  });

  it("reports syntax errors with a location and without schema errors", () => {
    const issues = issuesOf("version: 1\ncontent: [unclosed\n");
    expect(issues.every((issue) => issue.code === "yaml-syntax")).toBe(true);
    expect(issues[0]?.line).toBeGreaterThan(0);
  });

  it.each([[""], ["   \n\n"], ["# only a comment\n"]])("rejects empty input %j", (text) => {
    expect(summarize(issuesOf(text))).toEqual(["profile-empty"]);
  });

  it("does not pollute Object.prototype through __proto__ keys", () => {
    const yaml = `${BASE}__proto__:\n  polluted: true\n`;
    expect(summarize(issuesOf(yaml))).toEqual(["unknown-key /__proto__"]);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it("does not pollute Object.prototype through nested constructor keys", () => {
    const yaml = `${BASE}constructor:\n  prototype:\n    polluted: true\n`;
    expect(summarize(issuesOf(yaml))).toEqual(["unknown-key /constructor"]);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it("caps the number of reported issues", () => {
    const extraKeys = Array.from({ length: 200 }, (_, index) => `k${String(index)}: 1`).join("\n");
    const issues = issuesOf(`${BASE}${extraKeys}\n`);
    expect(issues.length).toBe(50);
  });

  it("handles very long scalars without failing unpredictably", () => {
    const issues = issuesOf(
      lines("version: 1", "content:", `  root: ${"a".repeat(100_000)}`, '  include: ["*.md"]'),
    );
    expect(summarize(issues)).toEqual(["invalid-value /content/root"]);
  });

  it("handles deeply nested input without throwing", () => {
    const nested = `${BASE}x: ${"[".repeat(500)}${"]".repeat(500)}\n`;
    const result = parseProfile(nested);
    expect(result.ok).toBe(false);
  });

  it("does not copy rejected values into issue parameters", () => {
    const secret = "super-secret-token-value";
    const serialized = JSON.stringify(issuesOf(`${BASE}locale: ${secret}\n`));
    expect(serialized).not.toContain(secret);
  });
});
