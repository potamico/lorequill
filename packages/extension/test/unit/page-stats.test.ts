import { describe, expect, it } from "vitest";
import { countWords, readingMinutes } from "../../src/core/page-stats";

describe("page statistics", () => {
  it("counts words of the body without front matter and Markdown symbols", () => {
    expect(
      countWords("---\ntitle: Many words here\n---\n# Title\n\nThis is *a* test, right?\n"),
    ).toBe(6);
    expect(countWords("- [x] Task 1\n- Größe und Bügel-Eisen\n")).toBe(5);
    expect(countWords("")).toBe(0);
  });

  it("estimates reading time at 200 words per minute", () => {
    expect(readingMinutes(0)).toBe(0);
    expect(readingMinutes(10)).toBe(1);
    expect(readingMinutes(450)).toBe(2);
  });
});
