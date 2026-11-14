import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  assignAnchors,
  collectAnchors,
  extractHeadings,
  parseMarkdown,
  slugifyAnchor,
  type AnchorSlugify,
} from "../../src";

interface FixtureCase {
  name: string;
  markdown: string;
  ascii: string[];
  unicode: string[];
}

const fixture = JSON.parse(
  readFileSync(
    resolve(import.meta.dirname, "../../../../fixtures/anchors/python-markdown.json"),
    "utf8",
  ),
) as { cases: FixtureCase[] };

function anchorsOf(markdown: string, slugify: AnchorSlugify): string[] {
  return assignAnchors(extractHeadings(parseMarkdown(markdown)), slugify).map(({ id }) => id);
}

describe("heading anchors match Python-Markdown", () => {
  for (const variant of ["ascii", "unicode"] as const) {
    describe(variant, () => {
      for (const testCase of fixture.cases) {
        it(testCase.name, () => {
          expect(anchorsOf(testCase.markdown, variant)).toEqual(testCase[variant]);
        });
      }
    });
  }
});

describe("slugifyAnchor", () => {
  it("removes accents in ascii mode but keeps them in unicode mode", () => {
    expect(slugifyAnchor("Identität", "ascii")).toBe("identitat");
    expect(slugifyAnchor("Identität", "unicode")).toBe("identität");
  });

  it("produces the same slug for composed and decomposed input", () => {
    const decomposed = "Identität";
    expect(slugifyAnchor(decomposed, "unicode")).toBe("identität");
    expect(slugifyAnchor(decomposed, "ascii")).toBe("identitat");
  });
});

describe("extractHeadings", () => {
  it("reports level, text, explicit identifier, and position", () => {
    const [heading] = extractHeadings(parseMarkdown("---\ntitle: x\n---\n\n## Hello {#hi}\n"));
    expect(heading).toMatchObject({ level: 2, text: "Hello", explicitId: "hi" });
    expect(heading?.start).toMatchObject({ line: 5, column: 1 });
  });

  it("does not treat front matter as a setext heading", () => {
    expect(extractHeadings(parseMarkdown("---\ntitle: x\n---\nBody\n"))).toEqual([]);
  });
});

describe("collectAnchors", () => {
  it("includes ids and names written in raw HTML", () => {
    const anchors = collectAnchors(
      parseMarkdown("# Title\n\n<a id=\"legacy\"></a>\n\nText <span name='inline'>x</span>\n"),
      "ascii",
    );
    expect([...anchors].sort()).toEqual(["inline", "legacy", "title"]);
  });
});
