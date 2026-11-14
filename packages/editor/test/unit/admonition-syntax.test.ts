import { GFM, parser } from "@lezer/markdown";
import { describe, expect, it } from "vitest";
import { admonitionSyntax, readAdmonitionHeader } from "../../src";

const markdown = parser.configure([GFM, admonitionSyntax]);

/** Top-level block names with their text, and the names of the blocks inside admonitions. */
function blocks(text: string): string[] {
  const result: string[] = [];
  const cursor = markdown.parse(text).cursor();
  if (!cursor.firstChild()) {
    return result;
  }
  do {
    const inside: string[] = [];
    if (cursor.name === "Admonition") {
      const child = cursor.node.cursor();
      if (child.firstChild()) {
        do {
          inside.push(child.name);
        } while (child.nextSibling());
      }
    }
    result.push(inside.length > 0 ? `${cursor.name}(${inside.join(",")})` : cursor.name);
  } while (cursor.nextSibling());
  return result;
}

describe("admonition syntax", () => {
  it("parses the indented body as Markdown inside the admonition", () => {
    const text = ['!!! tip "Hint"', "    Body with **bold**.", "", "    - item", "", "After"].join(
      "\n",
    );
    expect(blocks(text)).toEqual(["Admonition(AdmonitionMark,Paragraph,BulletList)", "Paragraph"]);
  });

  it("ends at the first line indented less than the body", () => {
    expect(blocks("??? note\n    Body\n\nNot inside\n")).toEqual([
      "Admonition(AdmonitionMark,Paragraph)",
      "Paragraph",
    ]);
  });

  it("interrupts a paragraph and supports collapsible markers", () => {
    expect(blocks("Text\n???+ warning\n    Body\n")).toEqual([
      "Paragraph",
      "Admonition(AdmonitionMark,Paragraph)",
    ]);
  });

  it("leaves other lines alone", () => {
    expect(blocks("!!!\n\n    code\n")).toEqual(["Paragraph", "CodeBlock"]);
    expect(blocks("```\n!!! note\n```\n")).toEqual(["FencedCode"]);
  });
});

describe("readAdmonitionHeader", () => {
  it("reads type, title, and family", () => {
    expect(readAdmonitionHeader('!!! tip "Good to know"')).toEqual({
      marker: "!!!",
      family: "tip",
      title: "Good to know",
      collapsible: false,
    });
    expect(readAdmonitionHeader("???+ error")).toEqual({
      marker: "???+",
      family: "danger",
      title: "Error",
      collapsible: true,
    });
    expect(readAdmonitionHeader("!!! custom")?.family).toBe("note");
    expect(readAdmonitionHeader("Text")).toBeUndefined();
  });
});
