import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { ensureSyntaxTree } from "@codemirror/language";
import { EditorState, type TransactionSpec } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import {
  alignColumn,
  cellAtCursor,
  cellCursor,
  cellSource,
  escapeCell,
  setCell,
  tableCells,
  deleteColumn,
  deleteRow,
  deleteTable,
  formatTable,
  inTable,
  insertColumn,
  insertRow,
  moveColumn,
  moveRow,
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

describe("cells of the table grid", () => {
  const doc = "Intro\n\n| Name | Value |\n| ---- | ----: |\n| a    |     1 |\n| b |\n";
  const tableStart = doc.indexOf("|");

  it("reads a cell's trimmed text and range", () => {
    const state = stateOf(doc);
    const source = cellSource(state, { table: tableStart, row: 1, column: 1 });
    expect(source?.text).toBe("1");
    expect(doc.slice(source?.from, source?.to)).toBe("1");
    expect(cellSource(state, { table: tableStart, row: 0, column: 0 })?.text).toBe("Name");
    expect(cellSource(state, { table: tableStart, row: 2, column: 1 })).toBeUndefined();
    expect(cellSource(state, { table: tableStart + 1, row: 0, column: 0 })).toBeUndefined();
  });

  it("writes only the cell's text while typing, with the cursor in the cell", () => {
    const state = stateOf(doc);
    const spec = setCell(state, { table: tableStart, row: 1, column: 0 }, "abc", 2);
    const next = state.update(spec ?? {}).state;
    expect(next.sliceDoc()).toBe(doc.replace("| a    |", "| abc    |"));
    expect(spec?.userEvent).toBe("input.type");
    const head = next.selection.main.head;
    expect(next.sliceDoc(head - 2, head)).toBe("ab");
  });

  it("does nothing when the text is unchanged", () => {
    expect(setCell(stateOf(doc), { table: tableStart, row: 1, column: 0 }, "a", 1)).toBeUndefined();
  });

  it("escapes pipes typed into a cell and keeps escaped ones", () => {
    const state = stateOf(doc);
    const spec = setCell(state, { table: tableStart, row: 1, column: 0 }, "x|y \\| z", 3);
    expect(state.update(spec ?? {}).state.sliceDoc()).toContain("| x\\|y \\| z    |");
    expect(escapeCell("a|b\\|c\nd")).toBe("a\\|b\\|c d");
  });

  it("adds a cell missing from a short row by realigning the table", () => {
    const state = stateOf(doc);
    const spec = setCell(state, { table: tableStart, row: 2, column: 1 }, "2", 1);
    const next = state.update(spec ?? {}).state;
    expect(next.sliceDoc()).toContain("| b    |     2 |");
    expect(next.sliceDoc(next.selection.main.head - 1, next.selection.main.head)).toBe("2");
  });

  it("maps a cell and offset to a cursor position and back", () => {
    const state = stateOf(doc);
    const address = { table: tableStart, row: 0, column: 1 };
    const position = cellCursor(state, address, 2);
    expect(doc.slice(position, position + 3)).toBe("lue");
    const moved = state.update({ selection: { anchor: position } }).state;
    expect(cellAtCursor(moved)).toEqual({ ...address, offset: 2 });
    expect(cellCursor(state, address, 99)).toBe(cellSource(state, address)?.to);
  });

  it("lists the cell texts of a table source without the delimiter row", () => {
    expect(tableCells("| a | b \\| c |\r\n|---|---|\r\n| 1 |")).toEqual([["a", "b \\| c"], ["1"]]);
  });
});

describe("leaving an aligned table", () => {
  it("does not rewrite a table that is already aligned", () => {
    const aligned = "| a   | b   |\n| --- | --- |\n| 1^   | 2   |";
    const state = stateOf(aligned);
    expect(formatTable(state)?.changes).toBeUndefined();
  });
});

describe("moving rows and columns", () => {
  const three = "| a | b |\n|---|--:|\n| 1 | 2 |\n| 3^ | 4 |";

  it("moves a body row up and down, with the cursor", () => {
    expect(run(three, (state) => moveRow(state, "up"))).toBe(
      "| a   |   b |\n| --- | --: |\n| 3^   |   4 |\n| 1   |   2 |",
    );
    expect(run(three, (state) => moveRow(state, "down"))).toBeUndefined();
  });

  it("never moves the header or a row above it", () => {
    expect(
      run("| a^ | b |\n|---|---|\n| 1 | 2 |", (state) => moveRow(state, "down")),
    ).toBeUndefined();
    expect(
      run("| a | b |\n|---|---|\n| 1^ | 2 |", (state) => moveRow(state, "up")),
    ).toBeUndefined();
  });

  it("moves a column with its alignment", () => {
    expect(run(three, (state) => moveColumn(state, "right"))).toBe(
      "|   b | a   |\n| --: | --- |\n|   2 | 1   |\n|   4 | 3^   |",
    );
    expect(run(three, (state) => moveColumn(state, "left"))).toBeUndefined();
  });
});

describe("deleteTable", () => {
  it("removes the table and keeps one blank line between the paragraphs", () => {
    expect(run("Intro\n\n| a |\n|---|\n| 1^ |\n\nEnd\n", deleteTable)).toBe("Intro\n\n^End\n");
  });

  it("removes a table at the end of the page", () => {
    expect(run("Intro\n\n| a |\n|---|\n| 1^ |", deleteTable)).toBe("Intro\n^");
  });

  it("removes a table at the start of the page", () => {
    expect(run("| a^ |\n|---|\n\nText", deleteTable)).toBe("^Text");
  });

  it("does nothing outside a table", () => {
    expect(run("Just ^text", deleteTable)).toBeUndefined();
  });
});
