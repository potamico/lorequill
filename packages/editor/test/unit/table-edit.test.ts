import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { ensureSyntaxTree } from "@codemirror/language";
import { EditorState, type TransactionSpec } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import {
  alignColumn,
  deleteColumn,
  deleteRow,
  formatTable,
  inTable,
  insertColumn,
  insertRow,
  nextCell,
  previousCell,
  tableEnter,
} from "../../src/table-edit";

/** A state from a document in which `^` marks the cursor. */
function stateOf(marked: string, lineBreak = "\n"): EditorState {
  const cursor = marked.indexOf("^");
  const doc = marked.replace("^", "");
  const state = EditorState.create({
    doc,
    selection: { anchor: cursor },
    extensions: [
      markdown({ base: markdownLanguage }),
      ...(lineBreak === "\n" ? [] : [EditorState.lineSeparator.of(lineBreak)]),
    ],
  });
  ensureSyntaxTree(state, state.doc.length, 5000);
  return state;
}

/** Applies a command and returns the document with `^` at the new cursor. */
function run(
  marked: string,
  command: (state: EditorState) => TransactionSpec | undefined,
): string | undefined {
  const state = stateOf(marked);
  const spec = command(state);
  if (!spec) {
    return undefined;
  }
  const next = state.update(spec).state;
  const head = next.selection.main.head;
  const doc = next.doc.toString();
  return `${doc.slice(0, head)}^${doc.slice(head)}`;
}

const table = ["| Name | Value |", "|---|--:|", "| a^ | 1 |", "| bb | 22 |"].join("\n");

describe("formatTable", () => {
  it("aligns every column to its widest cell and keeps alignment markers", () => {
    expect(run(table, formatTable)).toBe(
      ["| Name | Value |", "| ---- | ----: |", "| a^    |     1 |", "| bb   |    22 |"].join("\n"),
    );
  });

  it("pads short columns to three characters and centers centered columns", () => {
    expect(run("|a|b|\n|:-:|:--|\n|x^|y|", formatTable)).toBe(
      "|  a  | b   |\n| :-: | :-- |\n|  x^  | y   |",
    );
  });

  it("counts a decomposed umlaut as one character", () => {
    expect(run("| Name |\n|---|\n| Müller^ |", formatTable)).toBe(
      "| Name   |\n| ------ |\n| Müller^ |",
    );
  });

  it("keeps escaped pipes inside a cell", () => {
    expect(run("| a \\| b | c |\n|---|---|\n| 1^ | 2 |", formatTable)).toBe(
      "| a \\| b | c   |\n| ------ | --- |\n| 1^      | 2   |",
    );
  });

  it("fills short rows and accepts rows without outer pipes", () => {
    expect(run("a | b\n--|--\n1^", formatTable)).toBe(
      "| a   | b   |\n| --- | --- |\n| 1^   |     |",
    );
  });

  it("changes only the table and nothing around it", () => {
    expect(run(`Intro\n\n${table}\n\nEnd\n`, formatTable)).toBe(
      "Intro\n\n| Name | Value |\n| ---- | ----: |\n| a^    |     1 |\n| bb   |    22 |\n\nEnd\n",
    );
  });

  it("does nothing outside a table or in a table with excess cells", () => {
    expect(run("Just ^text", formatTable)).toBeUndefined();
    expect(run("| a | b |\n|---|---|\n| 1^ | 2 | 3 |", formatTable)).toBeUndefined();
  });

  it("does not treat tables inside lists as editable", () => {
    expect(run("- item\n\n  | a | b |\n  |---|---|\n  | 1^ | 2 |", formatTable)).toBeUndefined();
  });

  it("keeps CRLF line endings", () => {
    const state = stateOf("|a|b|\r\n|-|-|\r\n|1^|2|", "\r\n");
    const next = state.update(formatTable(state) ?? {}).state;
    expect(next.sliceDoc()).toBe("| a   | b   |\r\n| --- | --- |\r\n| 1   | 2   |");
  });
});

describe("nextCell and previousCell", () => {
  it("moves to the end of the next cell's text, across rows", () => {
    expect(run(table, nextCell)).toContain("| a    |     1^ |");
    expect(run("| Name | Value^ |\n|---|---|\n| a | 1 |", nextCell)).toContain("| a^    | 1     |");
  });

  it("adds a row after the last cell", () => {
    expect(run("| a | b |\n|---|---|\n| 1 | 2^ |", nextCell)).toBe(
      "| a   | b   |\n| --- | --- |\n| 1   | 2   |\n| ^    |     |",
    );
  });

  it("moves back to the previous cell, across rows, and stays in the first cell", () => {
    expect(run("| a | b |\n|---|---|\n| 1 | ^2 |", previousCell)).toContain("| 1^   | 2   |");
    expect(run("| a | b |\n|---|---|\n| ^1 | 2 |", previousCell)).toContain("| a   | b^   |");
    expect(run("| ^a | b |\n|---|---|", previousCell)).toBe("| a^   | b   |\n| --- | --- |");
  });

  it("is not available outside a table, so Tab keeps indenting lists", () => {
    expect(run("- ^item", nextCell)).toBeUndefined();
    expect(run("- ^item", previousCell)).toBeUndefined();
  });

  it("only moves in a table with excess cells", () => {
    const marked = "| a | b |\n|---|---|\n| 1^ | 2 | 3 |";
    expect(run(marked, nextCell)).toBe(marked);
  });
});

describe("tableEnter", () => {
  it("adds a row below and moves into its first cell", () => {
    expect(run("| a | b |\n|---|---|\n| 1 | 2^ |\n| 3 | 4 |", tableEnter)).toBe(
      "| a   | b   |\n| --- | --- |\n| 1   | 2   |\n| ^    |     |\n| 3   | 4   |",
    );
  });

  it("adds the first body row from the header", () => {
    expect(run("| a^ | b |\n|---|---|", tableEnter)).toBe(
      "| a   | b   |\n| --- | --- |\n| ^    |     |",
    );
  });

  it("ends the table on an empty last row", () => {
    expect(run("| a | b |\n|---|---|\n| 1 | 2 |\n| ^ |  |", tableEnter)).toBe(
      "| a   | b   |\n| --- | --- |\n| 1   | 2   |\n\n^",
    );
  });
});

describe("rows and columns", () => {
  it("inserts rows above and below; the header stays first", () => {
    expect(run(table, (state) => insertRow(state, "above"))).toContain(
      "| ---- | ----: |\n| ^     |       |\n| a    |     1 |",
    );
    expect(run(table, (state) => insertRow(state, "below"))).toContain(
      "| a    |     1 |\n| ^     |       |\n| bb   |    22 |",
    );
    expect(run("| a^ | b |\n|---|---|\n| 1 | 2 |", (state) => insertRow(state, "above"))).toBe(
      "| a   | b   |\n| --- | --- |\n| ^    |     |\n| 1   | 2   |",
    );
  });

  it("deletes body rows but not the header", () => {
    expect(run(table, deleteRow)).toBe("| Name | Value |\n| ---- | ----: |\n| ^bb   |    22 |");
    expect(run("| a^ | b |\n|---|---|\n| 1 | 2 |", deleteRow)).toBeUndefined();
  });

  it("inserts columns left and right with empty cells", () => {
    expect(run(table, (state) => insertColumn(state, "right"))).toBe(
      [
        "| Name |     | Value |",
        "| ---- | --- | ----: |",
        "| a    | ^    |     1 |",
        "| bb   |     |    22 |",
      ].join("\n"),
    );
    expect(run(table, (state) => insertColumn(state, "left"))).toContain("| ^    | a    |     1 |");
  });

  it("deletes the cursor's column but never the last one", () => {
    expect(run(table, deleteColumn)).toBe("| Value |\n| ----: |\n|     ^1 |\n|    22 |");
    expect(run("| a^ |\n|---|\n| 1 |", deleteColumn)).toBeUndefined();
  });

  it("sets the alignment of the cursor's column", () => {
    expect(run(table, (state) => alignColumn(state, "center"))).toContain("| :--: | ----: |");
    expect(run(table, (state) => alignColumn(state, "right"))).toContain("| ---: | ----: |");
    expect(run(table, (state) => alignColumn(state, "none"))).toContain("| ---- | ----: |");
  });

  it("works from the delimiter row as from the header", () => {
    expect(run("| a | b |\n|--^-|---|\n| 1 | 2 |", deleteColumn)).toBe(
      "| ^b   |\n| --- |\n| 2   |",
    );
  });

  it("reports whether the cursor is in an editable table", () => {
    expect(inTable(stateOf(table))).toBe(true);
    expect(inTable(stateOf("^Text"))).toBe(false);
  });
});
