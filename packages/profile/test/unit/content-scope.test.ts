import { describe, expect, it } from "vitest";
import { createContentScope } from "../../src/index";

function scope(include: string[], exclude?: string[]) {
  const [first = "", ...rest] = include;
  return createContentScope({ include: [first, ...rest], ...(exclude ? { exclude } : {}) });
}

describe("createContentScope", () => {
  it("matches files at any depth with **/*.md", () => {
    const pages = scope(["**/*.md"]);
    expect(pages.isIncluded("a.md")).toBe(true);
    expect(pages.isIncluded("guides/a.md")).toBe(true);
    expect(pages.isIncluded("guides/deep/er/a.md")).toBe(true);
    expect(pages.isIncluded("a.txt")).toBe(false);
    expect(pages.isIncluded("guides/a.markdown")).toBe(false);
  });

  it("matches only the content root with a pattern without a directory part", () => {
    const pages = scope(["*.md"]);
    expect(pages.isIncluded("a.md")).toBe(true);
    expect(pages.isIncluded("guides/a.md")).toBe(false);
  });

  it("applies exclude patterns after include patterns", () => {
    const pages = scope(["**/*.md"], ["**/index.md"]);
    expect(pages.isIncluded("index.md")).toBe(false);
    expect(pages.isIncluded("guides/index.md")).toBe(false);
    expect(pages.isIncluded("guides/other.md")).toBe(true);
  });

  it("excludes a directory only with an explicit descendant pattern", () => {
    const named = scope(["**/*.md"], ["drafts"]);
    expect(named.isIncluded("drafts/a.md")).toBe(true);
    const descendants = scope(["**/*.md"], ["drafts/**"]);
    expect(descendants.isIncluded("drafts/a.md")).toBe(false);
    expect(descendants.isIncluded("drafts/deep/a.md")).toBe(false);
    expect(descendants.isIncluded("other/a.md")).toBe(true);
  });

  it("accepts several include patterns", () => {
    const pages = scope(["guides/**/*.md", "reference/*.md"]);
    expect(pages.isIncluded("guides/a/b.md")).toBe(true);
    expect(pages.isIncluded("reference/a.md")).toBe(true);
    expect(pages.isIncluded("reference/sub/a.md")).toBe(false);
    expect(pages.isIncluded("other/a.md")).toBe(false);
  });

  it("supports brace alternatives", () => {
    const pages = scope(["**/*.{md,markdown}"]);
    expect(pages.isIncluded("a.md")).toBe(true);
    expect(pages.isIncluded("a.markdown")).toBe(true);
    expect(pages.isIncluded("a.txt")).toBe(false);
  });

  it("does not match dot files and dot directories unless the pattern names the dot", () => {
    const pages = scope(["**/*.md"]);
    expect(pages.isIncluded(".hidden.md")).toBe(false);
    expect(pages.isIncluded(".snippets/a.md")).toBe(false);
    expect(pages.isIncluded("guides/.hidden/a.md")).toBe(false);
    expect(scope([".snippets/*.md"]).isIncluded(".snippets/a.md")).toBe(true);
  });

  it("matches case-sensitively", () => {
    expect(scope(["**/*.md"]).isIncluded("README.MD")).toBe(false);
    expect(scope(["Guides/*.md"]).isIncluded("guides/a.md")).toBe(false);
  });

  it("does not treat negation as a pattern feature", () => {
    const pages = scope(["!draft.md"]);
    expect(pages.isIncluded("a.md")).toBe(false);
    expect(pages.isIncluded("draft.md")).toBe(false);
  });

  it("does not offer extended globs", () => {
    const pages = scope(["+(a|b).md"]);
    expect(pages.isIncluded("a.md")).toBe(false);
    expect(pages.isIncluded("b.md")).toBe(false);
  });

  it("treats a backslash as an escape character, never as a path separator", () => {
    const pages = scope(["**/*.md"]);
    expect(pages.isIncluded("guides\\a.md")).toBe(true);
    expect(scope(["guides/*.md"]).isIncluded("guides\\a.md")).toBe(false);
  });

  it("matches Unicode names", () => {
    const pages = scope(["**/*.md"]);
    expect(pages.isIncluded("Übersicht/Identität.md")).toBe(true);
    expect(pages.isIncluded("日本語/ページ.md")).toBe(true);
  });

  it("rejects an empty pattern, which a validated profile never contains", () => {
    expect(() => scope([""])).toThrow();
  });

  it("marks files matching a drafts pattern as drafts, whatever their type", () => {
    const pages = createContentScope({ include: ["**/*.md"], drafts: ["drafts/**"] });
    expect(pages.isDraft("drafts/idea.md")).toBe(true);
    expect(pages.isDraft("drafts/deep/sketch.png")).toBe(true);
    expect(pages.isDraft("guides/drafts.md")).toBe(false);
    expect(pages.isDraft("guides/drafts/idea.md")).toBe(false);
    // Drafts are pages like any other: they stay included.
    expect(pages.isIncluded("drafts/idea.md")).toBe(true);
  });

  it("has no drafts when no drafts list is given", () => {
    expect(scope(["**/*.md"]).isDraft("drafts/idea.md")).toBe(false);
  });

  it("excludes nothing when no exclude list is given", () => {
    expect(scope(["**/*.md"]).isIncluded("index.md")).toBe(true);
    expect(scope(["**/*.md"], []).isIncluded("index.md")).toBe(true);
  });

  it("is deterministic for repeated calls", () => {
    const pages = scope(["**/*.md"], ["**/index.md"]);
    for (let round = 0; round < 3; round++) {
      expect(pages.isIncluded("a.md")).toBe(true);
      expect(pages.isIncluded("index.md")).toBe(false);
    }
  });

  it("handles a large number of long alternatives without hanging", () => {
    const alternatives = Array.from({ length: 50 }, (_, index) => `name${String(index)}`).join(",");
    const pages = scope([`{${alternatives}}/**/*.md`]);
    const started = Date.now();
    expect(pages.isIncluded(`name49/${"a/".repeat(100)}b.md`)).toBe(true);
    expect(pages.isIncluded(`${"a".repeat(5000)}.md`)).toBe(false);
    expect(Date.now() - started).toBeLessThan(2000);
  });
});
