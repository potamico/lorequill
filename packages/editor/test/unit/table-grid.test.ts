import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { ensureSyntaxTree } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { cellPosition, findTables } from "../../src/table-grid";

function stateOf(doc: string): EditorState {
  const state = EditorState.create({ doc, extensions: markdown({ base: markdownLanguage }) });
  ensureSyntaxTree(state, state.doc.length, 5000);
  return state;
}

/** The text from each cell start to the end of its line, for readable expectations. */
function cellTexts(state: EditorState, doc: string): string[][] {
  const [table] = findTables(state);
  return (table?.cells ?? []).map((row) =>
    row.map((start) => doc.slice(start, state.doc.lineAt(start).to)),
  );
}

describe("findTables", () => {
  it("finds a top-level table with its line range and cell starts", () => {
    const doc = "Intro\n\n| Name | Wert |\n| ---- | ---: |\n| a    | 1    |\n\nEnd\n";
    const state = stateOf(doc);
    const tables = findTables(state);
    expect(tables).toHaveLength(1);
    const table = tables[0];
    expect(doc.slice(table?.from, table?.to)).toBe(
      "| Name | Wert |\n| ---- | ---: |\n| a    | 1    |",
    );
    expect(cellTexts(state, doc)).toEqual([
      ["Name | Wert |", "Wert |"],
      ["a    | 1    |", "1    |"],
    ]);
  });

  it("handles rows without outer pipes and empty cells", () => {
    const doc = "a | b | c\n--|---|--\n1 |   | 3\n";
    const state = stateOf(doc);
    expect(cellTexts(state, doc)).toEqual([
      ["a | b | c", "b | c", "c"],
      ["1 |   | 3", "| 3", "3"],
    ]);
  });

  it("leaves tables in lists and quotes as source", () => {
    const state = stateOf("- item\n\n  | a | b |\n  |---|---|\n  | 1 | 2 |\n\n> | a |\n> |---|\n");
    expect(findTables(state)).toEqual([]);
  });
});

describe("cellPosition", () => {
  it("maps rendered cells to source positions and falls back for missing cells", () => {
    const doc = "| a | b |\n|---|---|\n| 1 |\n";
    const state = stateOf(doc);
    const [table] = findTables(state);
    if (!table) {
      throw new Error("no table");
    }
    expect(doc.slice(cellPosition(state, table, 0, 1))).toMatch(/^b \|/);
    expect(cellPosition(state, table, 1, 1)).toBe(state.doc.line(3).to);
    expect(cellPosition(state, table, 5, 0)).toBe(table.from);
  });
});
