import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { ensureSyntaxTree } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { linkTargetAt } from "../../src";

/** The link target at the position marked with `|`. */
function targetAt(marked: string): string | undefined {
  const position = marked.indexOf("|");
  const state = EditorState.create({
    doc: marked.replace("|", ""),
    extensions: markdown({ base: markdownLanguage }),
  });
  ensureSyntaxTree(state, state.doc.length, 5000);
  return linkTargetAt(state, position);
}

describe("linkTargetAt", () => {
  it("finds the destination of an inline link from its text or URL", () => {
    expect(targetAt("See [the se|tup](guides/setup.md#install) page.")).toBe(
      "guides/setup.md#install",
    );
    expect(targetAt("See [setup](guides/se|tup.md).")).toBe("guides/setup.md");
    expect(targetAt("See [setup](<my |page.md>).")).toBe("my page.md");
  });

  it("finds images, autolinks, and bare URLs", () => {
    expect(targetAt("![lo|go](img/logo.png)")).toBe("img/logo.png");
    expect(targetAt("Visit <https://exa|mple.org>.")).toBe("https://example.org");
    expect(targetAt("Visit https://exa|mple.org today.")).toBe("https://example.org");
  });

  it("resolves reference links through their definition", () => {
    const definition = "\n\n[Setup Guide]: guides/setup.md";
    expect(targetAt(`Read [the gu|ide][setup guide].${definition}`)).toBe("guides/setup.md");
    expect(targetAt(`Read [Setup |Guide].${definition}`)).toBe("guides/setup.md");
    expect(targetAt("Read [miss|ing][nowhere].")).toBeUndefined();
  });

  it("finds nothing outside links", () => {
    expect(targetAt("Plain |text.")).toBeUndefined();
    expect(targetAt("`[not](a-link.md)` |here")).toBeUndefined();
  });
});
