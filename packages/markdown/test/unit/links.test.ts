import { describe, expect, it } from "vitest";
import { extractHeadings, extractLinks, parseMarkdown, type MarkdownLink } from "../../src";

function links(markdown: string): MarkdownLink[] {
  return extractLinks(parseMarkdown(markdown));
}

function destinations(markdown: string): string[] {
  return links(markdown).map(({ destination }) => destination);
}

describe("extractLinks", () => {
  it("finds inline links with titles and positions", () => {
    const [link] = links('Intro\n\nSee [the page](sub/page.md#part "Title") now.\n');
    expect(link).toMatchObject({
      kind: "inline",
      destination: "sub/page.md#part",
      title: "Title",
      start: { line: 3, column: 5, offset: 11 },
    });
  });

  it("reports reference links once, at their definition, even if unused", () => {
    const result = links(
      "[full][ref], [Ref][], [ref], [other][missing]\n\n[ref]: target.md\n[unused]: unused.md\n",
    );
    expect(result.map(({ kind, destination, label }) => [kind, destination, label])).toEqual([
      ["definition", "target.md", "ref"],
      ["definition", "unused.md", "unused"],
    ]);
  });

  it("recognizes angle-bracket destinations, escapes, and character references", () => {
    expect(destinations("[a](<with space.md>) [b](a\\(b\\).md) [c](a&amp;b.md)\n")).toEqual([
      "with space.md",
      "a(b).md",
      "a&b.md",
    ]);
  });

  it("keeps percent-encoding for the resolver", () => {
    expect(destinations("[a](with%20space.md)\n")).toEqual(["with%20space.md"]);
  });

  it("distinguishes autolinks", () => {
    expect(
      links("<https://example.com> and www.example.org and <a@example.com>\n").map(
        ({ kind, destination }) => [kind, destination],
      ),
    ).toEqual([
      ["autolink", "https://example.com"],
      ["autolink", "http://www.example.org"],
      ["autolink", "mailto:a@example.com"],
    ]);
  });

  it("ignores images, code spans, fenced code, and indented code", () => {
    const markdown = [
      "![image](pic.png) `[code](a.md)`",
      "",
      "```",
      "[fenced](b.md)",
      "```",
      "",
      "    [indented](c.md)",
      "",
      "[real](d.md)",
      "",
    ].join("\n");
    expect(destinations(markdown)).toEqual(["d.md"]);
  });

  it("finds links in lists, quotes, tables, and task items", () => {
    const markdown = [
      "- [x] [task](a.md)",
      "> [quote](b.md)",
      "",
      "| A |",
      "| - |",
      "| [cell](c.md) |",
      "",
    ].join("\n");
    expect(destinations(markdown)).toEqual(["a.md", "b.md", "c.md"]);
  });

  it("does not parse front matter as Markdown", () => {
    expect(destinations("---\nlink: '[x](front.md)'\n---\n[body](body.md)\n")).toEqual(["body.md"]);
  });

  it("does not guess links from unsupported syntax", () => {
    expect(destinations("[[wikilink]] and [text] (spaced.md) and [undefined][nope]\n")).toEqual([]);
  });

  it("handles CRLF line endings", () => {
    const [link] = links("Line one\r\n[a](a.md)\r\n");
    expect(link?.start).toMatchObject({ line: 2, column: 1, offset: 10 });
  });
});

describe("Material for MkDocs containers", () => {
  it("parses admonition bodies as Markdown, with exact positions", () => {
    const markdown = '# Title\n\n!!! note "Note"\n    See [inside](inside.md).\n';
    const [link] = links(markdown);
    expect(link?.destination).toBe("inside.md");
    expect(link?.start).toMatchObject({ line: 4, column: 9 });
    expect(markdown.slice(link?.start.offset, link?.end.offset)).toBe("[inside](inside.md)");
  });

  it("supports collapsible blocks, tabs, and nesting", () => {
    const markdown = [
      "??? tip",
      "    [details](a.md)",
      "",
      '???+ warning "Open"',
      '    === "Tab"',
      "",
      "        [nested](b.md)",
      "",
      '=== "Other"',
      "    [tab](c.md)",
      "",
    ].join("\n");
    const result = links(markdown);
    expect(result.map(({ destination }) => destination)).toEqual(["a.md", "b.md", "c.md"]);
    for (const link of result) {
      expect(markdown.slice(link.start.offset, link.end.offset)).toMatch(/^\[\w+\]\([abc]\.md\)$/);
    }
  });

  it("keeps fenced code inside an admonition as code", () => {
    const markdown = "!!! note\n    ```\n    [code](a.md)\n    ```\n    [real](b.md)\n";
    expect(destinations(markdown)).toEqual(["b.md"]);
  });

  it("ends the body at the first line that is not indented", () => {
    const markdown = "!!! note\n    [inside](a.md)\n\n[outside](b.md)\n";
    const document = parseMarkdown(markdown);
    expect(document.root.children.map(({ type }) => type)).toEqual(["container", "paragraph"]);
    expect(extractLinks(document).map(({ destination }) => destination)).toEqual(["a.md", "b.md"]);
  });

  it("continues the body with indented blocks after blank lines, like Python-Markdown", () => {
    const markdown = "!!! note\n    First\n\n    [still inside](a.md)\n";
    const [container] = parseMarkdown(markdown).root.children;
    expect(container?.type).toBe("container");
    expect(destinations(markdown)).toEqual(["a.md"]);
  });

  it("ignores markers inside fenced code and requires a type or a quoted tab title", () => {
    const markdown = "```\n!!! note\n    [code](a.md)\n```\n\n!!!\n    [x](b.md)\n\nTitle\n===\n";
    const document = parseMarkdown(markdown);
    expect(document.root.children.some(({ type }) => type === "container")).toBe(false);
    expect(extractHeadings(document).map(({ text }) => text)).toEqual(["Title"]);
  });

  it("treats an indented marker as code outside lists and as a container inside them", () => {
    expect(destinations("Text\n\n    !!! note\n        [code](a.md)\n")).toEqual([]);
    expect(destinations("- item\n\n    !!! note\n        [inside](a.md)\n")).toEqual(["a.md"]);
  });

  it("records kind, marker, type, and title", () => {
    const [container] = parseMarkdown('???+ warning "Achtung"\n    Text\n').root.children;
    expect(container).toMatchObject({
      type: "container",
      kind: "details",
      marker: "???+",
      containerType: "warning",
      title: "Achtung",
    });
  });
});
