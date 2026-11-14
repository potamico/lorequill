import type { Profile } from "@lorequill/profile";
import { describe, expect, it } from "vitest";
import {
  anchorItems,
  escapeLinkText,
  linkDestination,
  noLinkAt,
  pageLinkItems,
  slugifyOf,
} from "../../src/core/links/link-items";
import type { PageEntry } from "../../src/core/pages/scan";

function page(path: string, title: string): PageEntry {
  return {
    path,
    fileName: path.split("/").at(-1) ?? path,
    title,
    titleSource: "heading",
    aliases: [],
    frontMatter: "none",
  };
}

describe("link items", () => {
  const pages = [
    page("guides/setup.md", "Setup"),
    page("guides/index.md", "Guides"),
    page("über uns.md", "Über uns"),
    page("a (b).md", "Anhang"),
  ];

  it("offers other pages as relative, encoded .md paths sorted by title (AT 13)", () => {
    expect(
      pageLinkItems(pages, "guides/index.md").map(({ destination, page: { title } }) => [
        title,
        destination,
      ]),
    ).toEqual([
      ["Anhang", "../a%20%28b%29.md"],
      ["Setup", "setup.md"],
      ["Über uns", "../über%20uns.md"],
    ]);
  });

  it("links to a heading of another page or of the same page", () => {
    expect(linkDestination("guides/index.md", "guides/setup.md", "install-on-linux")).toBe(
      "setup.md#install-on-linux",
    );
    expect(linkDestination("guides/index.md", "guides/index.md", "a b")).toBe("#a%20b");
  });

  it("computes anchors like the relative-links check", () => {
    const text =
      "---\ntitle: X\n---\n# Über uns\n\n## Install {#setup}\n\n## Über uns\n\n```\n# not a heading\n```\n";
    expect(anchorItems(text, "ascii").map(({ id }) => id)).toEqual([
      "uber-uns",
      "setup",
      "uber-uns_1",
    ]);
    expect(anchorItems(text, "unicode").map(({ id }) => id)).toEqual([
      "über-uns",
      "setup",
      "über-uns_1",
    ]);
  });

  it("takes the anchor algorithm from the relative-links rule", () => {
    const base = { version: 1, content: { root: "docs", include: ["**/*.md"] } } as Profile;
    expect(slugifyOf(base)).toBe("ascii");
    expect(
      slugifyOf({
        ...base,
        checks: { rules: [{ id: "links", rule: "relative-links", slugify: "unicode" }] },
      }),
    ).toBe("unicode");
  });

  it("escapes link text", () => {
    expect(escapeLinkText(" a [b]\n c\\ ")).toBe("a \\[b\\] c\\\\");
  });
});

describe("noLinkAt", () => {
  function at(marked: string): boolean {
    return noLinkAt(marked.replace("|", ""), marked.indexOf("|"));
  }

  it("allows link destinations in text, lists, quotes, and tables", () => {
    for (const marked of ["See [x](a|", "- [x](a|", "> [x](a|", "| a |\n|---|\n| [x](a| |"]) {
      expect(at(marked), marked).toBe(false);
    }
  });

  it("refuses code, raw HTML, and front matter", () => {
    for (const marked of [
      "`[x](a|`",
      "```\n[x](a|\n```\n",
      "```\n[x](a|",
      "    [x](a|",
      "<div>\n[x](a|\n</div>",
      "---\nlink: [x](a|\n---\n# Page\n",
    ]) {
      expect(at(marked), marked).toBe(true);
    }
  });

  it("allows a link after inline code on the same line", () => {
    expect(at("`code` and [x](a|")).toBe(false);
  });
});
