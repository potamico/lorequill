import { updateFrontMatter } from "@lorequill/markdown";
import type { Collection } from "@lorequill/profile";
import { describe, expect, it } from "vitest";
import {
  domainOf,
  expandDefault,
  folderMatches,
  matchingCollections,
} from "../../src/core/properties/collections";
import { planPropertyEdit, type PropertyRequest } from "../../src/core/properties/edits";
import { buildPropertiesModel } from "../../src/core/properties/model";

const concept: Collection = {
  id: "concept",
  label: "Term",
  folder: "{domain}/concepts",
  match: { field: "type", equals: "concept" },
  fields: [
    { key: "title", label: "Title", widget: "string", required: true },
    { key: "type", widget: "hidden", default: "concept" },
    { key: "domain", widget: "hidden", default: "{domain}" },
    {
      key: "lifecycle",
      label: "Lifecycle",
      widget: "select",
      default: "Draft",
      options: ["Draft", "In Review", "Approved"],
    },
    { key: "aliases", label: "Aliases", widget: "list" },
    { key: "reviewed", widget: "date" },
    { key: "public", widget: "boolean" },
    { key: "summary", widget: "text" },
    { key: "owner", widget: "string", default: "team-{domain}" },
  ],
};
const glossary: Collection = { id: "glossary", folder: "{domain}/concepts" };

const page = [
  "---",
  "# Kommentar bleibt",
  "title: Access",
  "type: concept",
  "aliases:",
  "  - IAM",
  "lifecycle: Draft",
  "reviewed: '2026-01-15'",
  "custom: behalten",
  "rank: 3",
  "---",
  "",
  "# Access",
  "",
  "Body text with trailing spaces   ",
  "",
].join("\n");

function model(text = page, collections: readonly Collection[] = [concept], chosen?: string) {
  return buildPropertiesModel({
    collections,
    pagePath: "iam/concepts/access.md",
    text,
    ...(chosen === undefined ? {} : { chosenCollection: chosen }),
    describeIssue: (issue) => issue.code,
  });
}

/** Plans a request against the model of `text` and applies it like the host does. */
function apply(request: PropertyRequest, text = page): string {
  const planned = planPropertyEdit(model(text), request);
  if (!planned.ok) {
    throw new Error(planned.reason);
  }
  const result = updateFrontMatter(text, planned.edits);
  if (!result.ok) {
    throw new Error(result.issues[0]?.code);
  }
  return result.text;
}

const body = (text: string): string => text.slice(text.indexOf("\n---\n") + 5);

describe("collection matching", () => {
  it("expands {domain} as the first segment and matches the exact directory", () => {
    expect(domainOf("iam/concepts/a.md")).toBe("iam");
    expect(domainOf("a.md")).toBeUndefined();
    expect(folderMatches("{domain}/concepts", "iam/concepts/a.md")).toBe(true);
    expect(folderMatches("{domain}/concepts", "iam/concepts/sub/a.md")).toBe(false);
    expect(folderMatches("{domain}/concepts", "concepts/a.md")).toBe(false);
    expect(folderMatches("method/decisions", "method/decisions/a.md")).toBe(true);
    expect(expandDefault("team-{domain}", "iam/concepts/a.md")).toBe("team-iam");
  });

  it("requires the match field and reports several matches", () => {
    expect(matchingCollections([concept], "iam/concepts/a.md", { type: "concept" })).toEqual([
      concept,
    ]);
    expect(matchingCollections([concept], "iam/concepts/a.md", { type: "adr" })).toEqual([]);
    expect(
      matchingCollections([concept, glossary], "iam/concepts/a.md", { type: "concept" }),
    ).toEqual([concept, glossary]);
  });
});

describe("buildPropertiesModel", () => {
  it("shows collection fields without hidden ones, with values, and unknown keys", () => {
    const result = model();
    if (result.status !== "ok") {
      throw new Error(result.status);
    }
    expect(result.collection).toBe("concept");
    expect(result.fields.map(({ key }) => key)).toEqual([
      "title",
      "lifecycle",
      "aliases",
      "reviewed",
      "public",
      "summary",
      "owner",
    ]);
    expect(result.fields[0]).toMatchObject({ label: "Title", value: "Access", missing: false });
    expect(result.fields[2]).toMatchObject({ widget: "list", value: ["IAM"] });
    expect(result.fields[3]).toMatchObject({ widget: "date", value: "2026-01-15" });
    // Defaults are offered for missing fields only, with {domain} expanded.
    expect(result.fields[1]?.defaultValue).toBeUndefined();
    expect(result.fields[6]).toMatchObject({ present: false, defaultValue: "team-iam" });
    expect(result.unknown).toEqual([
      expect.objectContaining({ key: "custom", value: "behalten", editable: true }),
      expect.objectContaining({ key: "rank", editable: false, raw: "3" }),
    ]);
  });

  it("marks missing required fields", () => {
    const result = model(page.replace("title: Access\n", ""));
    expect(result.status === "ok" && result.fields[0]).toMatchObject({
      key: "title",
      present: false,
      missing: true,
    });
  });

  it("shows every key in the generic view without a matching collection", () => {
    const result = model(page, []);
    expect(result.status === "ok" && result.fields).toEqual([]);
    expect(result.status === "ok" && result.unknown.map(({ key }) => key)).toEqual([
      "title",
      "type",
      "aliases",
      "lifecycle",
      "reviewed",
      "custom",
      "rank",
    ]);
  });

  it("lets the author choose among several matching collections", () => {
    const result = model(page, [concept, glossary], "glossary");
    expect(result.status === "ok" && result.collection).toBe("glossary");
    expect(result.status === "ok" && result.collections.map(({ id }) => id)).toEqual([
      "concept",
      "glossary",
    ]);
  });

  it("is read-only for front matter that cannot be read safely", () => {
    const result = model("---\ntitle: a\ntitle: b\n---\nBody\n");
    expect(result).toEqual({
      status: "readonly",
      page: "iam/concepts/access.md",
      problems: ["yaml-duplicate-key"],
    });
  });
});

describe("property edits", () => {
  it("changes only the title, keeping comments, unknown fields, and the body (AT 3, 4)", () => {
    const text = apply({ type: "set", key: "title", value: "Access control" });
    expect(text).toContain("title: Access control");
    expect(text).toContain("# Kommentar bleibt");
    expect(text).toContain("custom: behalten");
    expect(text).toContain("rank: 3");
    expect(body(text)).toBe(body(page));
  });

  it("keeps lists as lists and quotes dates (AT 5)", () => {
    const listed = apply({ type: "set", key: "aliases", value: ["IAM", " ", "Access "] });
    expect(listed).toContain("aliases:\n  - IAM\n  - Access\n");
    const dated = apply({ type: "set", key: "reviewed", value: "2026-11-10" });
    expect(dated).toMatch(/reviewed: ["']2026-11-10["']/);
  });

  it("writes booleans and multi-line text", () => {
    expect(apply({ type: "set", key: "public", value: true })).toContain("public: true");
    const text = apply({ type: "set", key: "summary", value: "Line 1\r\nLine 2" });
    expect(text).toMatch(/summary: \|-?\n {2}Line 1\n {2}Line 2\n/);
  });

  it("omits cleared optional known fields but keeps required and unknown keys", () => {
    expect(apply({ type: "set", key: "lifecycle", value: "" })).not.toContain("lifecycle");
    expect(apply({ type: "set", key: "title", value: "" })).toMatch(/title: ["']{2}\n/);
    expect(apply({ type: "set", key: "custom", value: "" })).toMatch(/custom: ["']{2}\n/);
  });

  it("inserts a default only on request and only into a missing field", () => {
    expect(apply({ type: "insertDefault", key: "owner" })).toContain("owner: team-iam");
    expect(planPropertyEdit(model(), { type: "insertDefault", key: "lifecycle" })).toEqual({
      ok: false,
      reason: "stale",
    });
  });

  it("rejects values that do not fit the field", () => {
    const plan = (request: PropertyRequest) => planPropertyEdit(model(), request);
    expect(plan({ type: "set", key: "lifecycle", value: "Unbekannt" })).toMatchObject({
      reason: "invalid-value",
    });
    expect(plan({ type: "set", key: "reviewed", value: "2026-02-30" })).toMatchObject({
      reason: "invalid-value",
    });
    expect(plan({ type: "set", key: "title", value: "a\nb" })).toMatchObject({
      reason: "invalid-value",
    });
    expect(plan({ type: "set", key: "public", value: "true" })).toMatchObject({
      reason: "invalid-value",
    });
    expect(plan({ type: "set", key: "rank", value: "4" })).toMatchObject({
      reason: "not-editable",
    });
    expect(plan({ type: "set", key: "type", value: "adr" })).toMatchObject({ reason: "stale" });
    expect(plan({ type: "set", key: "nope", value: "x" })).toMatchObject({ reason: "stale" });
  });

  it("does not write anything for read-only front matter", () => {
    const readonly = model("---\nkey: [unclosed\n---\n");
    expect(planPropertyEdit(readonly, { type: "set", key: "key", value: "x" })).toEqual({
      ok: false,
      reason: "stale",
    });
  });
});
