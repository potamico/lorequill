import { describe, expect, it } from "vitest";
import { buildOutline, findAnchorLine, headingAt, type OutlineNode } from "../../src/core/outline";

interface Shape {
  readonly text: string;
  readonly line: number;
  readonly children?: readonly Shape[];
}

function shape(nodes: readonly OutlineNode[]): Shape[] {
  return nodes.map((node) => ({
    text: node.text,
    line: node.line,
    ...(node.children.length > 0 ? { children: shape(node.children) } : {}),
  }));
}

describe("buildOutline", () => {
  it("nests headings below the closest higher level", () => {
    const text = ["# Title", "", "## One", "### One A", "## Two", "# Appendix"].join("\n");
    expect(shape(buildOutline(text))).toEqual([
      {
        text: "Title",
        line: 0,
        children: [
          { text: "One", line: 2, children: [{ text: "One A", line: 3 }] },
          { text: "Two", line: 4 },
        ],
      },
      { text: "Appendix", line: 5 },
    ]);
  });

  it("nests a skipped level directly below the higher heading", () => {
    const outline = buildOutline("# Title\n### Deep\n## Next\n");
    expect(shape(outline)).toEqual([
      {
        text: "Title",
        line: 0,
        children: [
          { text: "Deep", line: 1 },
          { text: "Next", line: 2 },
        ],
      },
    ]);
    expect(outline[0]?.children[0]?.parent).toBe(outline[0]);
  });

  it("starts with lower levels when the page has no H1", () => {
    expect(shape(buildOutline("## A\n### B\n## C\n"))).toEqual([
      { text: "A", line: 0, children: [{ text: "B", line: 1 }] },
      { text: "C", line: 2 },
    ]);
  });

  it("ignores front matter and code blocks, and reads setext headings", () => {
    const text = [
      "---",
      "title: Not a heading",
      "---",
      "Setext",
      "======",
      "```",
      "# not a heading",
      "```",
      "## Real {#custom}",
    ].join("\n");
    expect(shape(buildOutline(text))).toEqual([
      { text: "Setext", line: 3, children: [{ text: "Real", line: 8 }] },
    ]);
  });

  it("uses the heading text without inline formatting", () => {
    expect(buildOutline("# A **bold** `code` [link](x.md)")[0]?.text).toBe("A bold code link");
  });

  it("is empty for a page without headings", () => {
    expect(buildOutline("Just text.\n")).toEqual([]);
  });
});

describe("headingAt", () => {
  const outline = buildOutline(
    ["Intro", "# Title", "text", "## One", "text", "### One A", "## Two", "text"].join("\n"),
  );

  it("finds the innermost heading whose section contains the line", () => {
    expect(headingAt(outline, 1)?.text).toBe("Title");
    expect(headingAt(outline, 2)?.text).toBe("Title");
    expect(headingAt(outline, 4)?.text).toBe("One");
    expect(headingAt(outline, 5)?.text).toBe("One A");
    expect(headingAt(outline, 7)?.text).toBe("Two");
  });

  it("finds nothing above the first heading", () => {
    expect(headingAt(outline, 0)).toBeUndefined();
  });
});

describe("findAnchorLine", () => {
  const text = ["# Guide", "", "## Install it", "", "## Über uns", "", "## Custom {#own-id}"].join(
    "\n",
  );

  it("finds headings by their generated or explicit anchor", () => {
    expect(findAnchorLine(text, "guide")).toBe(0);
    expect(findAnchorLine(text, "install-it")).toBe(2);
    expect(findAnchorLine(text, "own-id")).toBe(6);
  });

  it("accepts the anchors of both slugify variants", () => {
    expect(findAnchorLine(text, "uber-uns")).toBe(4);
    expect(findAnchorLine(text, "über-uns")).toBe(4);
  });

  it("finds nothing for an unknown anchor", () => {
    expect(findAnchorLine(text, "missing")).toBeUndefined();
  });
});
