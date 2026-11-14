import { describe, expect, it } from "vitest";
import {
  buildAnchors,
  lineForTop,
  lineInBlock,
  offsetInBlock,
  topForLine,
} from "../../src/scroll-sync";

describe("scroll synchronization", () => {
  const anchors = buildAnchors(
    [
      { line: 0, top: 10 },
      { line: 4, top: 100 },
      // Nested paragraph of the same list item: dropped.
      { line: 4, top: 104 },
      { line: 10, top: 400 },
      // A footnote rendered at the end but defined earlier: dropped.
      { line: 6, top: 900 },
    ],
    20,
    1000,
  );

  it("keeps only strictly increasing anchors and adds the end", () => {
    expect(anchors).toEqual([
      { line: 0, top: 10 },
      { line: 4, top: 100 },
      { line: 10, top: 400 },
      { line: 20, top: 1000 },
    ]);
  });

  it("maps block starts exactly and interpolates between them", () => {
    expect(topForLine(anchors, 4)).toBe(100);
    expect(topForLine(anchors, 7)).toBe(250);
    expect(topForLine(anchors, 15)).toBe(700);
    expect(lineForTop(anchors, 250)).toBe(7);
  });

  it("clamps outside the document", () => {
    expect(topForLine(anchors, -1)).toBe(10);
    expect(topForLine(anchors, 50)).toBe(1000);
    expect(lineForTop(anchors, 0)).toBe(0);
    expect(lineForTop(anchors, 5000)).toBe(20);
  });

  it("is its own inverse within the document", () => {
    for (let line = 0; line <= 20; line += 0.25) {
      expect(lineForTop(anchors, topForLine(anchors, line))).toBeCloseTo(line, 9);
    }
  });

  it("works for an empty preview", () => {
    const empty = buildAnchors([], 0, 0);
    expect(topForLine(empty, 3)).toBe(0);
    expect(lineForTop(empty, 30)).toBe(0);
  });
});

describe("editor blocks that cover several lines (live preview in Both)", () => {
  const frontMatter = { first: 0, count: 4 };
  const line = { first: 7, count: 1 };

  it("spreads the lines of a block evenly over its height", () => {
    expect(lineInBlock(frontMatter, 0)).toBe(0);
    expect(lineInBlock(frontMatter, 0.5)).toBe(2);
    expect(lineInBlock(frontMatter, 1)).toBe(4);
    expect(lineInBlock(line, 0.25)).toBe(7.25);
  });

  it("clamps positions outside the block", () => {
    expect(lineInBlock(frontMatter, -1)).toBe(0);
    expect(lineInBlock(frontMatter, 2)).toBe(4);
    expect(offsetInBlock(frontMatter, -3)).toBe(0);
    expect(offsetInBlock(frontMatter, 9)).toBe(1);
  });

  it("maps a line back to the same place in its block", () => {
    for (const within of [0, 0.3, 0.75, 1]) {
      expect(offsetInBlock(frontMatter, lineInBlock(frontMatter, within))).toBeCloseTo(within);
    }
    expect(offsetInBlock(frontMatter, 1)).toBe(0.25);
    expect(offsetInBlock(line, 7.5)).toBe(0.5);
    expect(offsetInBlock({ first: 3, count: 0 }, 3)).toBe(0);
  });
});
