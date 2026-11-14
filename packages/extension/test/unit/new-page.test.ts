import type { Collection } from "@lorequill/profile";
import { describe, expect, it } from "vitest";
import {
  checkFileName,
  collectionsForNewPage,
  newPageText,
  normalizeFileName,
  pagePathIn,
} from "../../src/core/pages/new-page";

const concept: Collection = {
  id: "concept",
  folder: "{domain}/concepts",
  match: { field: "type", equals: "concept" },
  template: "# {title}\n\n## Definition\n",
  fields: [
    { key: "title", widget: "string", required: true },
    { key: "type", widget: "hidden", default: "other" },
    { key: "domain", widget: "hidden", default: "{domain}" },
    { key: "reviewed", widget: "date", default: "2026-01-01" },
    { key: "public", widget: "boolean", default: false },
    { key: "aliases", widget: "list", default: ["{domain} term"] },
    { key: "summary", widget: "text" },
  ],
};

describe("file names of new pages", () => {
  it("appends .md and trims", () => {
    expect(normalizeFileName(" notes ")).toBe("notes.md");
    expect(normalizeFileName("Notes.MD")).toBe("Notes.MD");
    expect(normalizeFileName("   ")).toBe("");
  });

  it("rejects collisions, separators, path escapes, and reserved names (AT 11)", () => {
    const existing = ["Setup.md", "image.png"];
    expect(checkFileName("intro.md", existing)).toBeUndefined();
    expect(checkFileName("setup.md", existing)).toBe("exists");
    expect(checkFileName("image.png.md", existing)).toBeUndefined();
    expect(checkFileName(".md", existing)).toBe("empty");
    expect(checkFileName("../escape.md", existing)).toBe("separator");
    expect(checkFileName("sub\\page.md", existing)).toBe("separator");
    expect(checkFileName("what?.md", existing)).toBe("invalid-character");
    expect(checkFileName(".hidden.md", existing)).toBe("invalid-character");
    expect(checkFileName("con.md", existing)).toBe("reserved");
    expect(checkFileName(`${"a".repeat(260)}.md`, existing)).toBe("too-long");
  });

  it("builds the path in exactly the chosen directory", () => {
    expect(pagePathIn("", "a.md")).toBe("a.md");
    expect(pagePathIn("iam/concepts", "a.md")).toBe("iam/concepts/a.md");
  });
});

describe("text of new pages", () => {
  it("is a heading without a collection", () => {
    expect(newPageText("  New   page ", "notes/a.md", undefined)).toBe("# New page\n");
  });

  it("uses the collection's defaults, match value, and template", () => {
    expect(collectionsForNewPage([concept], "iam/concepts/a.md")).toEqual([concept]);
    expect(collectionsForNewPage([concept], "iam/other/a.md")).toEqual([]);
    expect(newPageText("Access", "iam/concepts/access.md", concept)).toBe(
      [
        "---",
        "title: Access",
        "type: concept",
        "domain: iam",
        'reviewed: "2026-01-01"',
        "public: false",
        "aliases:",
        "  - iam term",
        "---",
        "# Access",
        "",
        "## Definition",
        "",
      ].join("\n"),
    );
  });

  it("adds the match field when the collection has no such field", () => {
    const bare: Collection = { id: "adr", folder: "adr", match: { field: "kind", equals: "adr" } };
    expect(newPageText("ADR 1", "adr/adr-1.md", bare)).toBe("---\nkind: adr\n---\n# ADR 1\n");
  });
});
