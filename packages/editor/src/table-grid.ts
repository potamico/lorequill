import { syntaxTree } from "@codemirror/language";
import type { EditorState } from "@codemirror/state";
import type { SyntaxNode } from "@lezer/common";

/** A GFM table that `Edit` can show as a grid (specification §8). */
export interface TableBlock {
  /** Start of the header line. */
  readonly from: number;
  /** End of the last row line, without its line break. */
  readonly to: number;
  /**
   * Where the text of each cell starts, per rendered row: the header first, then the body rows,
   * without the delimiter row. A click on a cell puts the cursor there.
   */
  readonly cells: readonly (readonly number[])[];
}

/**
 * The tables of the page that can be shown as a grid. Only tables at the top level of the page
 * qualify, starting at the beginning of a line: tables in lists, quotes, or admonitions stay
 * visible as source, as do all constructs the live preview does not support.
 */
export function findTables(state: EditorState): TableBlock[] {
  const tables: TableBlock[] = [];
  const top = syntaxTree(state).topNode;
  for (let node = top.firstChild; node; node = node.nextSibling) {
    if (node.name === "Table" && state.doc.lineAt(node.from).from === node.from) {
      tables.push(readTable(state, node));
    }
  }
  return tables;
}

function readTable(state: EditorState, table: SyntaxNode): TableBlock {
  const cells: number[][] = [];
  for (let row = table.firstChild; row; row = row.nextSibling) {
    if (row.name === "TableHeader" || row.name === "TableRow") {
      cells.push(cellStarts(state, row));
    }
  }
  return { from: table.from, to: state.doc.lineAt(table.to).to, cells };
}

/** The start of each cell's text: after its opening pipe, past the padding spaces. */
function cellStarts(state: EditorState, row: SyntaxNode): number[] {
  const line = state.doc.lineAt(row.from);
  const pipes = row.getChildren("TableDelimiter");
  const boundaries: number[] = [];
  if (pipes[0]?.from !== row.from) {
    boundaries.push(row.from);
  }
  for (const pipe of pipes) {
    // A closing pipe at the end of the line opens no cell.
    if (state.sliceDoc(pipe.to, line.to).trim() !== "") {
      boundaries.push(pipe.to);
    }
  }
  return boundaries.map((start) => {
    let position = start;
    while (position < line.to && state.sliceDoc(position, position + 1) === " ") {
      position++;
    }
    return position;
  });
}

/**
 * The source position for a click on a rendered cell. Rows or cells the source does not have
 * (GFM fills short rows) fall back to the end of the row's line or the start of the table.
 */
export function cellPosition(
  state: EditorState,
  table: TableBlock,
  row: number,
  column: number,
): number {
  const cells = table.cells[row];
  if (!cells) {
    return table.from;
  }
  return cells[column] ?? state.doc.lineAt(cells[0] ?? table.from).to;
}
