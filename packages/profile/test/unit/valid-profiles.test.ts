import { describe, expect, it } from "vitest";
import {
  DEFAULT_CHECK_TIMEOUT_SECONDS,
  PROFILE_VERSION,
  parseProfile,
  validateProfileData,
} from "../../src/index";
import { BASE, expectOk, fixture, lines } from "./helpers";

describe("valid profiles", () => {
  it("accepts the minimal profile", () => {
    const profile = expectOk(parseProfile(fixture("valid/minimal.yaml")));
    expect(profile).toEqual({
      version: 1,
      content: { root: "docs", include: ["**/*.md"] },
    });
  });

  it("accepts a profile that uses every section and every built-in rule", () => {
    const profile = expectOk(parseProfile(fixture("valid/full.yaml")));

    expect(profile.locale).toBe("en-US");
    expect(profile.review?.base_branch).toBe("main");
    expect(profile.site).toEqual({
      url: "https://docs.example.org/handbook/",
      stable_links: { field: "slug", path: "id/{value}/" },
    });
    expect(profile.checks?.timeout_seconds).toBe(45);
    expect(profile.checks?.rules?.map((rule) => rule.rule)).toEqual([
      "forbidden-text",
      "unique-field",
      "allow-values",
      "relative-links",
      "field-format",
      "reference-field",
    ]);
    expect(profile.collections?.[0]?.fields?.map((field) => field.widget)).toEqual([
      "string",
      "hidden",
      "boolean",
      "date",
      "text",
      "list",
      "select",
    ]);
  });

  it("does not apply defaults to the parsed profile", () => {
    const profile = expectOk(parseProfile(BASE));
    expect(profile.checks).toBeUndefined();
    expect(profile.review).toBeUndefined();
    expect(profile.collections).toBeUndefined();
  });

  it("exposes the documented constants", () => {
    expect(PROFILE_VERSION).toBe(1);
    expect(DEFAULT_CHECK_TIMEOUT_SECONDS).toBe(30);
  });

  it("accepts an explicitly empty collections list", () => {
    expectOk(parseProfile(`${BASE}collections: []\n`));
  });

  it("treats rule text as a literal string, never as a pattern", () => {
    const profile = expectOk(
      parseProfile(
        `${BASE}${lines(
          "checks:",
          "  rules:",
          '    - { id: odd, rule: forbidden-text, text: "(unclosed[regex" }',
        )}`,
      ),
    );
    expect(profile.checks?.rules?.[0]).toMatchObject({ text: "(unclosed[regex" });
  });

  it("validates plain data without YAML", () => {
    expect(validateProfileData({ version: 1, content: { root: ".", include: ["*.md"] } }).ok).toBe(
      true,
    );
  });
});
