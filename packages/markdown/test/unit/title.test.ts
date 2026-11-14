import { describe, expect, it } from "vitest";
import { findFirstHeading, readPageMetadata } from "../../src/index";
import { fixture, toCrlf } from "./helpers";

describe("findFirstHeading", () => {
  it.each([
    ["an ATX heading", "# Title\n", "Title", 1],
    ["a level 3 heading", "### Deep\n", "Deep", 3],
    ["closing hashes", "## Title ##\n", "Title", 2],
    ["a heading that ends with a hash character", "# Learn C#\n", "Learn C#", 1],
    ["a trailing attribute list", "# Title { #custom-id .class }\n", "Title", 1],
    ["a trailing attribute list without spaces", "# Title {#custom-id}\n", "Title", 1],
    ["up to three spaces of indentation", "   # Indented\n", "Indented", 1],
    ["extra spaces and tabs", "#\tSpaced   \n", "Spaced", 1],
    ["a setext level 1 heading", "Title\n=====\n", "Title", 1],
    ["a setext level 2 heading", "Title\n-----\n", "Title", 2],
    ["text before the heading", "Intro text.\n\n# Later\n", "Later", 1],
    ["CRLF line endings", "# Title\r\nBody\r\n", "Title", 1],
    ["a heading without a final newline", "# Last", "Last", 1],
  ])("finds %s", (_name, text, expected, level) => {
    expect(findFirstHeading(text)).toEqual({ text: expected, level });
  });

  it.each([
    ["no heading", "Just text.\n"],
    ["an empty text", ""],
    ["a hashtag without a space", "#hashtag\n"],
    ["a heading indented by four spaces", "    # Code\n"],
    ["an empty heading", "#\n"],
    ["a heading in a backtick fence", "```\n# Not a heading\n```\n"],
    ["a heading in a tilde fence", "~~~\n# Not a heading\n~~~\n"],
    ["a heading in a longer fence", "````\n```\n# Inner\n```\n````\n"],
    ["a thematic break", "Text\n\n---\n"],
    ["a list item above a rule", "- item\n---\n"],
    ["a quote above a rule", "> quote\n---\n"],
  ])("finds nothing for %s", (_name, text) => {
    expect(findFirstHeading(text)).toBeUndefined();
  });

  it("finds the first heading after a fenced block", () => {
    expect(findFirstHeading("```\n# Inside\n```\n\n# Outside\n")).toEqual({
      text: "Outside",
      level: 1,
    });
  });

  it("continues after a fence that is closed by a longer fence", () => {
    expect(findFirstHeading("```\ncode\n`````\n# After\n")).toEqual({ text: "After", level: 1 });
  });

  it("does not close a fence with a different fence character", () => {
    expect(findFirstHeading("```\n~~~\n# Still inside\n```\n")).toBeUndefined();
  });

  it("skips empty headings and uses the next one", () => {
    expect(findFirstHeading("#\n\n## Real\n")).toEqual({ text: "Real", level: 2 });
  });

  it("starts at the given offset", () => {
    expect(findFirstHeading("# One\n# Two\n", 6)).toEqual({ text: "Two", level: 1 });
  });
});

describe("readPageMetadata", () => {
  it("prefers the front matter title", () => {
    const metadata = readPageMetadata("---\ntitle: From Front Matter\n---\n# Heading\n", "page.md");
    expect(metadata).toMatchObject({ title: "From Front Matter", titleSource: "front-matter" });
  });

  it("falls back to the first heading of the body", () => {
    expect(readPageMetadata("---\nstatus: x\n---\n# Heading\n", "page.md")).toMatchObject({
      title: "Heading",
      titleSource: "heading",
      frontMatter: "ok",
    });
  });

  it("does not take headings from the front matter", () => {
    const text = "---\n# a comment that looks like a heading\nstatus: x\n---\nNo heading here.\n";
    expect(readPageMetadata(text, "page.md")).toMatchObject({
      title: "page.md",
      titleSource: "filename",
    });
  });

  it("falls back to the file name exactly as given", () => {
    expect(readPageMetadata("Only text.\n", "my-page.md")).toMatchObject({
      title: "my-page.md",
      titleSource: "filename",
      frontMatter: "none",
    });
    expect(readPageMetadata("", "Ünïcode name.md").title).toBe("Ünïcode name.md");
  });

  it.each([
    ["an empty title", "title: ''"],
    ["a whitespace title", "title: '   '"],
    ["a numeric title", "title: 2026"],
    ["a list title", "title: [a, b]"],
    ["a null title", "title:"],
  ])("ignores %s", (_name, yaml) => {
    const metadata = readPageMetadata(`---\n${yaml}\n---\n# Heading\n`, "page.md");
    expect(metadata).toMatchObject({ title: "Heading", titleSource: "heading" });
  });

  it("trims the front matter title", () => {
    expect(readPageMetadata("---\ntitle: '  Padded  '\n---\n", "p.md").title).toBe("Padded");
  });

  it("still uses the heading when the front matter is invalid", () => {
    const metadata = readPageMetadata(fixture("invalid-front-matter.md"), "page.md");
    expect(metadata).toMatchObject({
      title: "Heading",
      titleSource: "heading",
      frontMatter: "invalid",
    });
  });

  it("uses the file name when invalid front matter is not followed by a heading", () => {
    const metadata = readPageMetadata("---\ntitle: [unclosed\n---\nText.\n", "page.md");
    expect(metadata).toMatchObject({
      title: "page.md",
      titleSource: "filename",
      frontMatter: "invalid",
    });
  });

  it("reads string aliases only", () => {
    const text = "---\naliases: [first, '  second  ', 42, true, '', {a: b}, [x]]\n---\n";
    expect(readPageMetadata(text, "p.md").aliases).toEqual(["first", "second"]);
  });

  it("returns no aliases when the field is missing or not a list", () => {
    expect(readPageMetadata("---\ntitle: T\n---\n", "p.md").aliases).toEqual([]);
    expect(readPageMetadata("---\naliases: just one\n---\n", "p.md").aliases).toEqual([]);
    expect(readPageMetadata("# Heading\n", "p.md").aliases).toEqual([]);
  });

  it("reads the Material constructs fixture", () => {
    expect(readPageMetadata(fixture("material-constructs.md"), "constructs.md")).toEqual({
      title: "Constructs",
      titleSource: "front-matter",
      aliases: ["first alias", "second alias"],
      frontMatter: "ok",
    });
  });

  it("finds the heading in the Material fixture when the title is removed", () => {
    const text = fixture("material-constructs.md").replace("title: Constructs\n", "");
    expect(readPageMetadata(text, "constructs.md")).toMatchObject({
      title: "Constructs",
      titleSource: "heading",
    });
  });

  it("gives the same result for LF and CRLF text", () => {
    for (const name of [
      "material-constructs.md",
      "comments-and-unknown-keys.md",
      "no-front-matter.md",
    ]) {
      const text = fixture(name);
      expect(readPageMetadata(toCrlf(text), name), name).toEqual(readPageMetadata(text, name));
    }
  });

  it("ignores headings inside fenced code of the body", () => {
    const text = fixture("material-constructs.md");
    expect(findFirstHeading(text.slice(text.indexOf("~~~")))).toBeUndefined();
  });
});
