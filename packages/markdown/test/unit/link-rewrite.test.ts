import { describe, expect, it } from "vitest";
import {
  applyTextEdits,
  movedPath,
  originalPath,
  rewriteLinksForMoves,
  type PathMove,
} from "../../src";

function rewrite(text: string, source: string, moves: PathMove[]): string {
  return applyTextEdits(text, rewriteLinksForMoves(text, source, moves));
}

describe("movedPath", () => {
  it("maps moved files and paths below moved directories", () => {
    const moves = [
      { from: "a/b.md", to: "c/b.md" },
      { from: "old", to: "new/place" },
    ];
    expect(movedPath("a/b.md", moves)).toBe("c/b.md");
    expect(movedPath("old/x/y.md", moves)).toBe("new/place/x/y.md");
    expect(movedPath("old", moves)).toBe("new/place");
    expect(movedPath("older/y.md", moves)).toBe("older/y.md");
    expect(originalPath("c/b.md", moves)).toBe("a/b.md");
    expect(originalPath("new/place/x/y.md", moves)).toBe("old/x/y.md");
    expect(originalPath("a/b.md", moves)).toBe("a/b.md");
  });
});

describe("rewriteLinksForMoves", () => {
  const toConcepts = [{ from: "terms/value-stream.md", to: "glossary/value-stream.md" }];

  it("updates links to a moved page, keeping text, title, query, and fragment", () => {
    expect(
      rewrite(
        'See [Value stream](terms/value-stream.md#definition "Title") and [Q](terms/value-stream.md?x=1).\n',
        "index.md",
        toConcepts,
      ),
    ).toBe(
      'See [Value stream](glossary/value-stream.md#definition "Title") and [Q](glossary/value-stream.md?x=1).\n',
    );
  });

  it("updates reference definitions, images, and angle-bracket destinations", () => {
    const text = [
      "[Ref][w] ![Image](terms/image.svg) [Angle](<terms/value-stream.md>)",
      "",
      '[w]: terms/value-stream.md "T"',
      "",
    ].join("\n");
    const moves = [
      { from: "terms/value-stream.md", to: "glossary/value-stream.md" },
      { from: "terms/image.svg", to: "assets/image.svg" },
    ];
    expect(rewrite(text, "index.md", moves)).toBe(
      [
        "[Ref][w] ![Image](assets/image.svg) [Angle](<glossary/value-stream.md>)",
        "",
        '[w]: glossary/value-stream.md "T"',
        "",
      ].join("\n"),
    );
  });

  it("updates the relative links of a moved page itself", () => {
    const text =
      "[Start](../index.md) [Neighbor](capability.md) [Here](#section) [Web](https://x.ch)\n";
    expect(
      rewrite(text, "terms/value-stream.md", [
        { from: "terms/value-stream.md", to: "a/b/value-stream.md" },
      ]),
    ).toBe(
      "[Start](../../index.md) [Neighbor](../../terms/capability.md) [Here](#section) [Web](https://x.ch)\n",
    );
  });

  it("leaves links alone that still resolve, also when both pages move together", () => {
    const text = "[Neighbor](capability.md) [Other](../index.md)\n";
    const moves = [{ from: "terms", to: "glossary" }];
    expect(rewriteLinksForMoves(text, "terms/value-stream.md", moves)).toEqual([]);
  });

  it("follows a moved directory and encodes new paths", () => {
    const text = "[Page](old/with%20spaces.md) [Folder](old/) [Dot](./old/x.md)\n";
    expect(rewrite(text, "index.md", [{ from: "old", to: "new place" }])).toBe(
      "[Page](new%20place/with%20spaces.md) [Folder](new%20place) [Dot](./new%20place/x.md)\n",
    );
  });

  it("ignores links in code, in front matter, and invalid or outside destinations", () => {
    const text = [
      "---",
      "link: terms/value-stream.md",
      "---",
      "`[x](terms/value-stream.md)`",
      "",
      "    [y](terms/value-stream.md)",
      "",
      "[outside](../../terms/value-stream.md) [abs](/terms/value-stream.md)",
      "",
    ].join("\n");
    expect(rewriteLinksForMoves(text, "index.md", toConcepts)).toEqual([]);
  });

  it("handles parentheses and brackets around the destination", () => {
    const text = "[a (b) [c]](terms/value-stream.md (Title)) [d](x_(1).md)\n";
    expect(rewrite(text, "index.md", [...toConcepts, { from: "x_(1).md", to: "y/x_(1).md" }])).toBe(
      "[a (b) [c]](glossary/value-stream.md (Title)) [d](y/x_%281%29.md)\n",
    );
  });
});
