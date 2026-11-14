import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { ensureSyntaxTree } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import {
  insertPageLink,
  LIMITS,
  linkCompletionContext,
  linkDestinationContext,
  matchCompletions,
  parseHostMessage,
  parseWebviewMessage,
} from "../../src";

function at(marked: string) {
  const position = marked.indexOf("|");
  const state = EditorState.create({
    doc: marked.replace("|", ""),
    extensions: markdown({ base: markdownLanguage }),
    selection: { anchor: position },
  });
  ensureSyntaxTree(state, state.doc.length, 5000);
  return { state, position };
}

describe("linkCompletionContext", () => {
  it("completes the page part of a destination being typed", () => {
    const { state, position } = at("See [setup](gui|");
    expect(linkCompletionContext(state, position)).toEqual({ kind: "page", from: 12 });
    const closed = at("See [setup](|)");
    expect(linkCompletionContext(closed.state, closed.position)).toEqual({
      kind: "page",
      from: 12,
    });
  });

  it("completes anchors after #, for another page or the current one", () => {
    const other = at("[x](guides/setup.md#ins|");
    expect(linkCompletionContext(other.state, other.position)).toEqual({
      kind: "anchor",
      from: 20,
      page: "guides/setup.md",
    });
    const own = at("[x](#|)");
    expect(linkCompletionContext(own.state, own.position)).toEqual({
      kind: "anchor",
      from: 5,
      page: "",
    });
  });

  it("does not complete outside destinations or inside code", () => {
    for (const marked of ["plain (text|", "[x](a b|", "`[x](a|`", "```\n[x](a|\n```"]) {
      const { state, position } = at(marked);
      expect(linkCompletionContext(state, position)).toBeUndefined();
    }
  });
});

describe("linkDestinationContext", () => {
  it("finds the destination being typed at the end of a line prefix", () => {
    expect(linkDestinationContext("See [setup](gui")).toEqual({ kind: "page", start: 12 });
    expect(linkDestinationContext("[x](")).toEqual({ kind: "page", start: 4 });
    expect(linkDestinationContext("[x](a.md#in")).toEqual({
      kind: "anchor",
      start: 9,
      page: "a.md",
    });
    expect(linkDestinationContext("[x](#")).toEqual({ kind: "anchor", start: 5, page: "" });
  });

  it("ignores text that is not an open inline destination", () => {
    for (const prefix of ["plain (text", "[x](a b", "[x](a) and", "[x](<a", ""]) {
      expect(linkDestinationContext(prefix)).toBeUndefined();
    }
  });
});

describe("matchCompletions", () => {
  const items = [
    { label: "../architecture/principles.md", detail: "Design guidelines" },
    { label: "iam/concepts/access.md", detail: "Permissions", keywords: ["IAM", "Authorization"] },
    { label: "glossary.md", detail: "Glossary" },
    { label: "search.md", detail: "Research notes" },
  ];
  const labels = (typed: string) => matchCompletions(items, typed).map(({ label }) => label);

  it("offers every item in its order for empty text", () => {
    expect(labels("")).toEqual(items.map(({ label }) => label));
  });

  it("matches path, title, and aliases, ignoring case", () => {
    expect(labels("guideline")).toEqual(["../architecture/principles.md"]);
    expect(labels("authoriz")).toEqual(["iam/concepts/access.md"]);
    expect(labels("PERMISSIONS")).toEqual(["iam/concepts/access.md"]);
    expect(labels("../arch")).toEqual(["../architecture/principles.md"]);
    expect(labels("nothing")).toEqual([]);
  });

  it("ranks start, then word start, then anywhere, and keeps the order within a rank", () => {
    // "search.md" starts with it, "Research" contains it inside a word, "access" not at all.
    expect(labels("search")).toEqual(["search.md"]);
    expect(labels("s")).toEqual([
      "search.md",
      "../architecture/principles.md",
      "iam/concepts/access.md",
      "glossary.md",
    ]);
    // "concepts" is a word start in the path of access.md; the others have it inside a word.
    expect(labels("c")).toEqual([
      "iam/concepts/access.md",
      "../architecture/principles.md",
      "search.md",
    ]);
  });

  it("compares Unicode text in NFC", () => {
    const decomposed = [{ label: "a.md", detail: "Übersicht" }];
    expect(matchCompletions(decomposed, "u\u0308ber")).toHaveLength(1);
  });
});

describe("insertPageLink", () => {
  it("replaces the selection with an escaped link and puts the cursor after it", () => {
    const state = EditorState.create({ doc: "See setup now", selection: { anchor: 4, head: 9 } });
    const next = state.update(insertPageLink(state, "Set [up]", "guides/setup.md#a")).state;
    expect(next.doc.toString()).toBe("See [Set \\[up\\]](guides/setup.md#a) now");
    expect(next.selection.main.head).toBe(35);
  });
});

describe("link messages", () => {
  it("validates insert link and completion messages", () => {
    expect(parseWebviewMessage({ type: "insertLink", selection: "text" })).toEqual({
      type: "insertLink",
      selection: "text",
    });
    expect(parseWebviewMessage({ type: "complete", id: 3, anchorsOf: "a.md" })).toEqual({
      type: "complete",
      id: 3,
      anchorsOf: "a.md",
    });
    expect(parseWebviewMessage({ type: "complete", id: -1 })).toBeUndefined();
    expect(parseWebviewMessage({ type: "complete", id: 1, anchorsOf: "a\u0000" })).toBeUndefined();
    expect(
      parseHostMessage({ type: "completions", id: 3, items: [{ label: "a.md", detail: "A" }] }),
    ).toEqual({ type: "completions", id: 3, items: [{ label: "a.md", detail: "A" }] });
    expect(parseHostMessage({ type: "completions", id: 3, items: [{ label: 1 }] })).toBeUndefined();
    expect(
      parseHostMessage({ type: "completions", id: 4, items: [{ label: "a.md", keywords: ["A"] }] }),
    ).toEqual({ type: "completions", id: 4, items: [{ label: "a.md", keywords: ["A"] }] });
    for (const keywords of [
      "A",
      [1],
      ["x".repeat(LIMITS.maxLinkText + 1)],
      Array.from({ length: LIMITS.maxKeywords + 1 }, () => "a"),
    ]) {
      expect(
        parseHostMessage({ type: "completions", id: 5, items: [{ label: "a.md", keywords }] }),
      ).toBeUndefined();
    }
    expect(parseHostMessage({ type: "insertLink", text: "A", destination: "a.md" })).toEqual({
      type: "insertLink",
      text: "A",
      destination: "a.md",
    });
  });
});
