import { GFM, parser } from "@lezer/markdown";
import { describe, expect, it } from "vitest";
import { singleTildeStrikethrough } from "../../src/strikethrough-syntax";

const markdown = parser.configure([GFM, singleTildeStrikethrough]);

/** The struck-through spans of a text, with their marks. */
function struck(text: string): string[] {
  const spans: string[] = [];
  markdown.parse(text).iterate({
    enter(node) {
      if (node.name === "Strikethrough") {
        spans.push(text.slice(node.from, node.to));
      }
    },
  });
  return spans;
}

describe("single-tilde strikethrough", () => {
  it("strikes through text between single tildes, like GFM and the preview", () => {
    expect(struck("~~struck through~~ and ~single tilde~.")).toEqual([
      "~~struck through~~",
      "~single tilde~",
    ]);
  });

  it("marks the tildes as StrikethroughMark, so the live preview hides them", () => {
    const marks: string[] = [];
    const text = "a ~b~ c";
    markdown.parse(text).iterate({
      enter(node) {
        if (node.name === "StrikethroughMark") {
          marks.push(`${String(node.from)}-${String(node.to)}`);
        }
      },
    });
    expect(marks).toEqual(["2-3", "4-5"]);
  });

  it("pairs only tildes of the same length, as micromark does", () => {
    // micromark: <del>a~~ and ~~b</del>; the double tildes inside are text.
    expect(struck("~a~~ and ~~b~")).toEqual(["~a~~ and ~~b~"]);
    expect(struck("~~a~ x")).toEqual([]);
  });

  it("leaves runs of three tildes and tildes between spaces alone", () => {
    expect(struck("~~~a~~~")).toEqual([]);
    expect(struck("a ~ b ~ c")).toEqual([]);
    expect(struck("~ a~")).toEqual([]);
  });

  it("works next to punctuation and inside other inline syntax", () => {
    expect(struck("(~a~), **~b~**")).toEqual(["~a~", "~b~"]);
  });

  it("does not apply inside code", () => {
    expect(struck("`~a~` and\n\n    ~b~")).toEqual([]);
  });
});
