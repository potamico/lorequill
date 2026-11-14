import { EditorSelection, EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import {
  insertHorizontalRule,
  insertLink,
  insertTable,
  toggleBlock,
  toggleCodeBlock,
  toggleInline,
  toggleTask,
  type BlockFormat,
  type InlineFormat,
} from "../../src";

/** Builds a state from text with `[` `]` marking the selection (or `|` for a cursor). */
function stateOf(marked: string): EditorState {
  const cursor = marked.indexOf("|");
  if (cursor !== -1) {
    const doc = marked.replace("|", "");
    return EditorState.create({ doc, selection: EditorSelection.cursor(cursor) });
  }
  const from = marked.indexOf("[[");
  const to = marked.indexOf("]]") - 2;
  const doc = marked.replace("[[", "").replace("]]", "");
  return EditorState.create({
    doc,
    ...(from === -1 ? {} : { selection: EditorSelection.range(from, to) }),
    extensions: EditorState.allowMultipleSelections.of(true),
  });
}

/** Applies a command and marks the resulting selection the same way. */
function run(
  marked: string,
  command: (state: EditorState) => ReturnType<typeof toggleBlock>,
): string | undefined {
  const state = stateOf(marked);
  const spec = command(state);
  if (!spec) {
    return undefined;
  }
  const result = state.update(spec).state;
  const { from, to } = result.selection.main;
  const doc = result.doc.toString();
  return from === to
    ? `${doc.slice(0, from)}|${doc.slice(from)}`
    : `${doc.slice(0, from)}[[${doc.slice(from, to)}]]${doc.slice(to)}`;
}

const inline = (format: InlineFormat) => (state: EditorState) => toggleInline(state, format);
const block = (format: BlockFormat) => (state: EditorState) => toggleBlock(state, format);

describe("inline formatting", () => {
  it("wraps and unwraps the selection", () => {
    expect(run("a [[word]] b", inline("bold"))).toBe("a **[[word]]** b");
    expect(run("a **[[word]]** b", inline("bold"))).toBe("a [[word]] b");
    expect(run("a [[**word**]] b", inline("bold"))).toBe("a [[word]] b");
    expect(run("[[x]]", inline("strikethrough"))).toBe("~~[[x]]~~");
    expect(run("[[x]]", inline("code"))).toBe("`[[x]]`");
  });

  it("removes strikethrough with one or two tildes and adds it with two", () => {
    expect(run("a ~~[[word]]~~ b", inline("strikethrough"))).toBe("a [[word]] b");
    expect(run("a ~[[word]]~ b", inline("strikethrough"))).toBe("a [[word]] b");
    expect(run("a [[~word~]] b", inline("strikethrough"))).toBe("a [[word]] b");
    expect(run("a [[~~word~~]] b", inline("strikethrough"))).toBe("a [[word]] b");
    // Unequal or longer runs are ambiguous and stay as they are.
    expect(run("a ~[[word]]~~ b", inline("strikethrough"))).toBeUndefined();
    expect(run("a ~~~[[word]]~~~ b", inline("strikethrough"))).toBeUndefined();
  });

  it("inserts empty markers at a cursor and removes them again", () => {
    expect(run("a | b", inline("italic"))).toBe("a *|* b");
    expect(run("a *|* b", inline("italic"))).toBe("a | b");
  });

  it("tells bold and italic apart", () => {
    expect(run("**[[bold]]**", inline("italic"))).toBeUndefined();
    expect(run("*[[it]]*", inline("bold"))).toBeUndefined();
    expect(run("***[[both]]***", inline("italic"))).toBe("**[[both]]**");
    expect(run("***[[both]]***", inline("bold"))).toBe("*[[both]]*");
  });

  it("does not rewrite selections across lines", () => {
    expect(run("a[[b\nc]]d", inline("bold"))).toBeUndefined();
  });
});

describe("block formatting", () => {
  it("sets, replaces, and removes headings", () => {
    expect(run("Title|", block("heading2"))).toBe("## Title|");
    expect(run("# Title|", block("heading2"))).toBe("## Title|");
    expect(run("## Title|", block("heading2"))).toBe("Title|");
    expect(run("|", block("heading1"))).toBe("# |");
    expect(run("|Title", block("heading3"))).toBe("### |Title");
    expect(run("#|# Title", block("heading1"))).toBe("# |Title");
    expect(run("Ti|tle", block("heading2"))).toBe("## Ti|tle");
    expect(run("|# Title", block("heading1"))).toBe("|Title");
  });

  it("toggles and converts lists, keeping indentation and skipping blank lines", () => {
    expect(run("[[one\n\ntwo]]", block("bullet"))).toBe("- [[one\n\n- two]]");
    expect(run("[[- one\n- two]]", block("bullet"))).toBe("[[one\ntwo]]");
    expect(run("[[- one\n  - two]]", block("numbered"))).toBe("1. [[one\n  2. two]]");
    expect(run("[[1. one\n2. two]]", block("task"))).toBe("- [ ] [[one\n- [ ] two]]");
    expect(run("[[- [x] done]]", block("task"))).toBe("[[done]]");
    expect(run("[[- [x] done]]", block("bullet"))).toBe("- [[done]]");
  });

  it("puts a cursor at the line start behind the new list marker", () => {
    expect(run("|", block("bullet"))).toBe("- |");
    expect(run("|", block("numbered"))).toBe("1. |");
    expect(run("|", block("task"))).toBe("- [ ] |");
    expect(run("  |", block("bullet"))).toBe("  - |");
    expect(run("|one", block("bullet"))).toBe("- |one");
    expect(run("- |one", block("numbered"))).toBe("1. |one");
    expect(run("- |one", block("bullet"))).toBe("|one");
    expect(run("o|ne", block("task"))).toBe("- [ ] o|ne");
  });

  it("toggles quotes", () => {
    expect(run("[[a\nb]]", block("quote"))).toBe("> [[a\n> b]]");
    expect(run("[[> a\n> b]]", block("quote"))).toBe("[[a\nb]]");
    expect(run("|", block("quote"))).toBe("> |");
    expect(run("|a", block("quote"))).toBe("> |a");
    expect(run("> |a", block("quote"))).toBe("|a");
  });

  it("does not include a line where the selection only ends", () => {
    expect(run("[[a\n]]b", block("bullet"))).toBe("- [[a\n]]b");
  });

  it("leaves Material constructs outside the selection untouched", () => {
    const doc = '!!! note "Note"\n    Text\n\n=== "Tab"\n\n    Body\n\nTitle|\n';
    expect(run(doc, block("heading1"))).toBe(doc.replace("Title|", "# Title|"));
  });
});

describe("code blocks and inserted blocks", () => {
  it("wraps lines in a fenced block and unwraps it again", () => {
    expect(run("[[code]]", (state) => toggleCodeBlock(state))).toBe("```\n[[code]]\n```");
    expect(run("co|de", (state) => toggleCodeBlock(state))).toBe("```|\ncode\n```");
    expect(run("|", (state) => toggleCodeBlock(state))).toBe("```|\n\n```");
    expect(run("```\n[[code]]\n```", (state) => toggleCodeBlock(state))).toBe("[[code]]");
  });

  it("inserts a horizontal rule and a table on their own lines", () => {
    expect(run("Text|", (state) => insertHorizontalRule(state))).toBe("Text\n\n---\n|");
    expect(run("|", (state) => insertTable(state, ["A", "Long header"]))).toBe(
      "| A   | Long header |\n| --- | ----------- |\n|     |             |\n|",
    );
  });

  it("inserts a link with the selection as text and selects the destination", () => {
    expect(run("see [[this]]", (state) => insertLink(state))).toBe("see [this]([[page.md]])");
  });

  it("uses the document's line break", () => {
    const state = EditorState.create({
      doc: "a",
      selection: EditorSelection.cursor(1),
      extensions: EditorState.lineSeparator.of("\r\n"),
    });
    const result = state.update(insertHorizontalRule(state)).state;
    expect(result.sliceDoc()).toBe("a\r\n\r\n---\r\n");
  });
});

describe("toggleTask", () => {
  function toggled(doc: string, from: number): string | undefined {
    const state = EditorState.create({ doc });
    const spec = toggleTask(state, from);
    return spec ? state.update(spec).state.doc.toString() : undefined;
  }

  it("checks and unchecks with a single-character edit", () => {
    expect(toggled("- [ ] Task", 2)).toBe("- [x] Task");
    expect(toggled("- [x] Task", 2)).toBe("- [ ] Task");
    expect(toggled("- [X] Task", 2)).toBe("- [ ] Task");
    const spec = toggleTask(EditorState.create({ doc: "- [ ] Task" }), 2);
    expect(spec?.changes).toEqual({ from: 3, to: 4, insert: "x" });
  });

  it("does nothing where there is no task marker", () => {
    expect(toggled("- [y] Task", 2)).toBeUndefined();
    expect(toggled("- Task", 2)).toBeUndefined();
  });
});
