import { describe, expect, it } from "vitest";
import type { PageEntry } from "../../src/core/pages/scan";
import {
  buildPageTree,
  createLabelCollator,
  filterPages,
  matchesFilter,
  type DirectoryNode,
  type TreeNode,
} from "../../src/core/pages/tree";

function page(path: string, title?: string, aliases: string[] = []): PageEntry {
  const fileName = path.slice(path.lastIndexOf("/") + 1);
  return {
    path,
    fileName,
    title: title ?? fileName,
    titleSource: title === undefined ? "filename" : "heading",
    aliases,
    frontMatter: "none",
  };
}

const collator = createLabelCollator("en");

function outline(node: DirectoryNode): string[] {
  const lines: string[] = [];
  const walk = (children: readonly TreeNode[], depth: number): void => {
    for (const child of children) {
      const indent = "  ".repeat(depth);
      if (child.kind === "directory") {
        lines.push(`${indent}${child.name}/`);
        walk(child.children, depth + 1);
      } else {
        lines.push(`${indent}${child.page.title}`);
      }
    }
  };
  walk(node.children, 0);
  return lines;
}

describe("buildPageTree", () => {
  it("nests pages in directories, directories first", () => {
    const tree = buildPageTree(
      [
        page("zeta.md", "Zeta"),
        page("guides/setup.md", "Setup"),
        page("guides/deep/more.md", "More"),
        page("alpha.md", "Alpha"),
        page("reference/api.md", "API"),
      ],
      collator,
    );
    expect(outline(tree)).toEqual([
      "guides/",
      "  deep/",
      "    More",
      "  Setup",
      "reference/",
      "  API",
      "Alpha",
      "Zeta",
    ]);
  });

  it("creates directories only for pages that exist", () => {
    const tree = buildPageTree([page("a/b/c/page.md", "Page")], collator);
    expect(outline(tree)).toEqual(["a/", "  b/", "    c/", "      Page"]);
    expect(buildPageTree([], collator).children).toEqual([]);
  });

  it("records the relative path of each directory", () => {
    const tree = buildPageTree([page("a/b/page.md", "Page")], collator);
    const a = tree.children[0];
    expect(a?.kind === "directory" && a.path).toBe("a");
    const b = a?.kind === "directory" ? a.children[0] : undefined;
    expect(b?.kind === "directory" && b.path).toBe("a/b");
  });

  it("sorts by label with natural number order and ignores case", () => {
    const tree = buildPageTree(
      [page("p10.md", "Page 10"), page("p2.md", "page 2"), page("p1.md", "Page 1")],
      collator,
    );
    expect(outline(tree)).toEqual(["Page 1", "page 2", "Page 10"]);
  });

  it("sorts German umlauts with the German collator", () => {
    const german = createLabelCollator("de-CH");
    const tree = buildPageTree(
      [page("z.md", "Zebra"), page("a.md", "Äpfel"), page("b.md", "Birne"), page("o.md", "Olive")],
      german,
    );
    expect(outline(tree)).toEqual(["Äpfel", "Birne", "Olive", "Zebra"]);
  });

  it("orders pages with equal titles by path", () => {
    const pages = [page("d/b.md", "Same"), page("d/c.md", "Same"), page("d/a.md", "Same")];
    const pathsOf = (tree: DirectoryNode): string[] => {
      const directory = tree.children[0];
      return directory?.kind === "directory"
        ? directory.children.flatMap((node) => (node.kind === "page" ? [node.page.path] : []))
        : [];
    };
    expect(pathsOf(buildPageTree(pages, collator))).toEqual(["d/a.md", "d/b.md", "d/c.md"]);
    expect(pathsOf(buildPageTree([...pages].reverse(), collator))).toEqual([
      "d/a.md",
      "d/b.md",
      "d/c.md",
    ]);
  });

  it("does not depend on the order of the input", () => {
    const pages = [
      page("b.md", "B"),
      page("a/z.md", "Z"),
      page("a/y.md", "Y"),
      page("c/d/e.md", "E"),
      page("c/f.md", "F"),
    ];
    const expected = outline(buildPageTree(pages, collator));
    for (let shift = 1; shift < pages.length; shift++) {
      const rotated = [...pages.slice(shift), ...pages.slice(0, shift)];
      expect(outline(buildPageTree(rotated, collator))).toEqual(expected);
    }
  });
});

describe("filtering", () => {
  const identity = page("identitaet.md", "Identität", ["Identity", "Persona"]);
  const pages = [
    identity,
    page("guides/setup.md", "Installation", ["Setup guide"]),
    page("guides/Schema.md", "Metadata", []),
    page("plain.md"),
  ];

  it("matches the title", () => {
    expect(filterPages(pages, "install").map((entry) => entry.path)).toEqual(["guides/setup.md"]);
  });

  it("matches the file name", () => {
    expect(filterPages(pages, "schema").map((entry) => entry.path)).toEqual(["guides/Schema.md"]);
    expect(filterPages(pages, "plain.md").map((entry) => entry.path)).toEqual(["plain.md"]);
  });

  it("matches string aliases", () => {
    expect(filterPages(pages, "persona").map((entry) => entry.path)).toEqual(["identitaet.md"]);
    expect(filterPages(pages, "SETUP GUIDE").map((entry) => entry.path)).toEqual([
      "guides/setup.md",
    ]);
  });

  it("matches inside words and ignores case", () => {
    expect(matchesFilter(identity, "ENTITÄT")).toBe(true);
  });

  it("does not match the directory path", () => {
    expect(filterPages(pages, "guides")).toEqual([]);
  });

  it("returns every page for an empty or blank filter", () => {
    expect(filterPages(pages, "")).toHaveLength(4);
    expect(filterPages(pages, "   ")).toHaveLength(4);
  });

  it("returns nothing when no page matches", () => {
    expect(filterPages(pages, "no such page")).toEqual([]);
  });

  it("treats composed and decomposed characters alike", () => {
    expect(matchesFilter(page("x.md", "Identität"), "Identita\u0308t")).toBe(true);
    expect(matchesFilter(page("x.md", "Identita\u0308t"), "Identität")).toBe(true);
  });

  it("keeps ancestor directories of matches and drops the rest", () => {
    const tree = buildPageTree(filterPages(pages, "setup"), collator);
    expect(outline(tree)).toEqual(["guides/", "  Installation"]);
  });

  it("treats special characters as plain text", () => {
    expect(filterPages(pages, ".*")).toEqual([]);
    expect(filterPages([page("a.md", "What? (really)")], "(really)")).toHaveLength(1);
  });
});
