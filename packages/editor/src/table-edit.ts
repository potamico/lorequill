import { EditorSelection, type EditorState, type TransactionSpec } from "@codemirror/state";
import { findTables } from "./table-grid";

/**
 * Table tools (specification §8): moving between cells, adding and removing rows and columns,
 * setting a column's alignment, and realigning the table. Every command rewrites only the table
 * that contains the cursor, as one undoable edit, and keeps the text of every cell.
 */

export type ColumnAlignment = "left" | "center" | "right" | "none";

interface ParsedTable {
  readonly from: number;
  readonly to: number;
  /** The header first, then the body rows; the delimiter row is kept as `alignments`. */
  readonly rows: string[][];
  readonly alignments: ColumnAlignment[];
  /** False when a row has more cells than the header: GFM drops them, so nothing is rewritten. */
  readonly regular: boolean;
}

interface CellCursor {
  readonly row: number;
  readonly column: number;
  /** Offset of the cursor in the cell's trimmed text, in UTF-16 code units like positions. */
  readonly offset: number;
}

const MIN_WIDTH = 3;

/** Splits a table line into its cells at unescaped pipes, without the outer pipes. */
function splitRow(text: string): { cells: string[]; starts: number[] } {
  const cells: string[] = [];
  const starts: number[] = [];
  let start = 0;
  let end = text.length;
  while (start < end && text[start] === " ") {
    start++;
  }
  while (end > start && text[end - 1] === " ") {
    end--;
  }
  if (text[start] === "|") {
    start++;
  }
  if (end > start && text[end - 1] === "|" && text[end - 2] !== "\\") {
    end--;
  }
  let cellStart = start;
  for (let index = start; index <= end; index++) {
    if (index === end || (text[index] === "|" && text[index - 1] !== "\\")) {
      const raw = text.slice(cellStart, index);
      // An empty cell starts after one padding space, so typed text gets a space before it.
      const trimmed = raw.trimStart();
      const leading = trimmed === "" ? Math.min(1, raw.length) : raw.length - trimmed.length;
      cells.push(raw.trim());
      starts.push(cellStart + leading);
      cellStart = index + 1;
    }
  }
  return { cells, starts };
}

function alignmentOf(cell: string): ColumnAlignment {
  const left = cell.startsWith(":");
  const right = cell.endsWith(":") && cell.length > 1;
  if (left && right) {
    return "center";
  }
  if (left) {
    return "left";
  }
  return right ? "right" : "none";
}

const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });

/**
 * Width of a cell's text for aligning the source, in user-perceived characters: "ü" counts once
 * whether it is one code point or two.
 */
function widthOf(text: string): number {
  return Array.from(graphemes.segment(text)).length;
}

function parseTable(state: EditorState, from: number, to: number): ParsedTable {
  const first = state.doc.lineAt(from).number;
  const last = state.doc.lineAt(to).number;
  const rows: string[][] = [];
  let alignments: ColumnAlignment[] = [];
  for (let number = first; number <= last; number++) {
    const { cells } = splitRow(state.doc.line(number).text);
    if (number === first + 1) {
      alignments = cells.map(alignmentOf);
    } else {
      rows.push(cells);
    }
  }
  const columns = rows[0]?.length ?? 0;
  const regular = rows.every((row) => row.length <= columns);
  for (const row of rows) {
    while (row.length < columns) {
      row.push("");
    }
  }
  alignments = Array.from({ length: columns }, (_, index) => alignments[index] ?? "none");
  return { from, to, rows, alignments, regular };
}

/** The top-level table that contains the main cursor, with the cell the cursor is in. */
function tableAtCursor(state: EditorState): { table: ParsedTable; cursor: CellCursor } | undefined {
  const head = state.selection.main.head;
  const block = findTables(state).find((table) => head >= table.from && head <= table.to);
  if (!block) {
    return undefined;
  }
  const table = parseTable(state, block.from, block.to);
  const line = state.doc.lineAt(head);
  const index = line.number - state.doc.lineAt(block.from).number;
  const { starts, cells } = splitRow(line.text);
  const position = head - line.from;
  // The cell is given by the unescaped pipes before the cursor, not counting an opening pipe.
  let pipes = 0;
  for (let index = 0; index < position; index++) {
    if (line.text[index] === "|" && line.text[index - 1] !== "\\") {
      pipes++;
    }
  }
  const opening = line.text.trimStart().startsWith("|") ? 1 : 0;
  const columns = table.rows[0]?.length ?? 1;
  const column = Math.min(Math.max(pipes - opening, 0), columns - 1);
  const text = cells[column] ?? "";
  const offset = Math.min(Math.max(position - (starts[column] ?? position), 0), text.length);
  // The delimiter row counts as the header for moving and inserting.
  const row = index <= 1 ? 0 : index - 1;
  return { table, cursor: { row, column, offset: index === 1 ? 0 : offset } };
}

function pad(text: string, width: number, alignment: ColumnAlignment): [string, number] {
  const space = width - widthOf(text);
  if (alignment === "right") {
    return [" ".repeat(space) + text, space];
  }
  if (alignment === "center") {
    const before = Math.floor(space / 2);
    return [" ".repeat(before) + text + " ".repeat(space - before), before];
  }
  return [text + " ".repeat(space), 0];
}

function delimiter(width: number, alignment: ColumnAlignment): string {
  switch (alignment) {
    case "left":
      return `:${"-".repeat(width - 1)}`;
    case "center":
      return `:${"-".repeat(width - 2)}:`;
    case "right":
      return `${"-".repeat(width - 1)}:`;
    default:
      return "-".repeat(width);
  }
}

/**
 * Writes the table aligned, and returns where each cell's text starts, relative to the start of
 * the table and counting every line break as one character.
 */
function format(
  rows: readonly (readonly string[])[],
  alignments: readonly ColumnAlignment[],
  lineBreak: string,
): { text: string; starts: number[][] } {
  const widths = alignments.map((_, column) =>
    Math.max(MIN_WIDTH, ...rows.map((row) => widthOf(row[column] ?? ""))),
  );
  const lines: string[] = [];
  const starts: number[][] = [];
  let offset = 0;
  const addRow = (cells: readonly string[], record: boolean): void => {
    let line = "|";
    const rowStarts: number[] = [];
    cells.forEach((cell, column) => {
      const [padded, before] = pad(cell, widths[column] ?? MIN_WIDTH, alignments[column] ?? "none");
      rowStarts.push(offset + line.length + 1 + before);
      line += ` ${padded} |`;
    });
    if (record) {
      starts.push(rowStarts);
    }
    lines.push(line);
    offset += line.length + 1;
  };
  rows.forEach((row, index) => {
    addRow(row, true);
    if (index === 0) {
      addRow(
        widths.map((width, column) => delimiter(width, alignments[column] ?? "none")),
        false,
      );
    }
  });
  return { text: lines.join(lineBreak), starts };
}

/** Replaces the table with its aligned form and puts the cursor into `target`. */
function rewrite(
  state: EditorState,
  table: ParsedTable,
  rows: string[][],
  alignments: ColumnAlignment[],
  target: CellCursor,
  after = "",
  userEvent = "input.format",
): TransactionSpec {
  const { text, starts } = format(rows, alignments, state.lineBreak);
  const row = Math.min(target.row, rows.length - 1);
  const column = Math.min(target.column, (rows[0]?.length ?? 1) - 1);
  const cell = rows[row]?.[column] ?? "";
  const anchor =
    after === ""
      ? table.from + (starts[row]?.[column] ?? 0) + Math.min(target.offset, cell.length)
      : table.from + state.toText(text + after).length;
  const selection = EditorSelection.cursor(anchor);
  // An already aligned table is not rewritten, so leaving a cell changes nothing.
  if (text + after === state.sliceDoc(table.from, table.to)) {
    return { selection, scrollIntoView: true };
  }
  return {
    changes: { from: table.from, to: table.to, insert: text + after },
    selection,
    userEvent,
    scrollIntoView: true,
  };
}

function emptyRow(columns: number): string[] {
  return Array.from({ length: columns }, () => "");
}

/** Realigns the table at the cursor. */
export function formatTable(state: EditorState): TransactionSpec | undefined {
  const found = tableAtCursor(state);
  if (!found?.table.regular) {
    return undefined;
  }
  const { table, cursor } = found;
  return rewrite(state, table, table.rows, table.alignments, cursor);
}

/**
 * Tab in a table: realigns it and moves to the end of the next cell's text. From the last cell, a
 * new row is added. `undefined` outside a table, so Tab keeps its other meanings.
 */
export function nextCell(state: EditorState): TransactionSpec | undefined {
  const found = tableAtCursor(state);
  if (!found) {
    return undefined;
  }
  const { table, cursor } = found;
  const columns = table.rows[0]?.length ?? 1;
  const rows = table.rows.map((row) => [...row]);
  let target: CellCursor;
  if (cursor.column + 1 < columns) {
    target = { row: cursor.row, column: cursor.column + 1, offset: Infinity };
  } else {
    if (cursor.row + 1 >= rows.length) {
      rows.push(emptyRow(columns));
    }
    target = { row: cursor.row + 1, column: 0, offset: Infinity };
  }
  return table.regular
    ? rewrite(state, table, rows, table.alignments, target)
    : { selection: state.selection };
}

/** Shift+Tab in a table: realigns it and moves to the end of the previous cell's text. */
export function previousCell(state: EditorState): TransactionSpec | undefined {
  const found = tableAtCursor(state);
  if (!found) {
    return undefined;
  }
  const { table, cursor } = found;
  const columns = table.rows[0]?.length ?? 1;
  let target: CellCursor = { row: 0, column: 0, offset: Infinity };
  if (cursor.column > 0) {
    target = { row: cursor.row, column: cursor.column - 1, offset: Infinity };
  } else if (cursor.row > 0) {
    target = { row: cursor.row - 1, column: columns - 1, offset: Infinity };
  }
  return table.regular
    ? rewrite(state, table, table.rows, table.alignments, target)
    : { selection: state.selection };
}

/**
 * Enter in a table: a cell cannot contain a line break, so Enter adds a row below and moves into
 * its first cell. Enter in an empty last row removes it and ends the table with a blank line.
 */
export function tableEnter(state: EditorState): TransactionSpec | undefined {
  const found = tableAtCursor(state);
  if (!found?.table.regular || !state.selection.main.empty) {
    return undefined;
  }
  const { table, cursor } = found;
  const columns = table.rows[0]?.length ?? 1;
  const rows = table.rows.map((row) => [...row]);
  const last = cursor.row === rows.length - 1;
  if (cursor.row > 0 && last && rows[cursor.row]?.every((cell) => cell === "")) {
    rows.pop();
    const lineBreak = state.lineBreak;
    return rewrite(state, table, rows, table.alignments, cursor, lineBreak + lineBreak);
  }
  rows.splice(cursor.row + 1, 0, emptyRow(columns));
  return rewrite(state, table, rows, table.alignments, {
    row: cursor.row + 1,
    column: 0,
    offset: 0,
  });
}

/** Adds an empty row above or below the cursor's row; the header always stays first. */
export function insertRow(
  state: EditorState,
  where: "above" | "below",
): TransactionSpec | undefined {
  const found = tableAtCursor(state);
  if (!found?.table.regular) {
    return undefined;
  }
  const { table, cursor } = found;
  const rows = table.rows.map((row) => [...row]);
  const at = where === "below" || cursor.row === 0 ? cursor.row + 1 : cursor.row;
  rows.splice(at, 0, emptyRow(rows[0]?.length ?? 1));
  return rewrite(state, table, rows, table.alignments, {
    row: at,
    column: cursor.column,
    offset: 0,
  });
}

/** Removes the cursor's row. The header row cannot be removed. */
export function deleteRow(state: EditorState): TransactionSpec | undefined {
  const found = tableAtCursor(state);
  if (!found?.table.regular || found.cursor.row === 0) {
    return undefined;
  }
  const { table, cursor } = found;
  const rows = table.rows.filter((_, index) => index !== cursor.row);
  const row = Math.min(cursor.row, rows.length - 1);
  return rewrite(state, table, rows, table.alignments, { row, column: cursor.column, offset: 0 });
}

/** Adds an empty column left or right of the cursor's column. */
export function insertColumn(
  state: EditorState,
  where: "left" | "right",
): TransactionSpec | undefined {
  const found = tableAtCursor(state);
  if (!found?.table.regular) {
    return undefined;
  }
  const { table, cursor } = found;
  const at = where === "right" ? cursor.column + 1 : cursor.column;
  const rows = table.rows.map((row) => {
    const copy = [...row];
    copy.splice(at, 0, "");
    return copy;
  });
  const alignments = [...table.alignments];
  alignments.splice(at, 0, "none");
  return rewrite(state, table, rows, alignments, { row: cursor.row, column: at, offset: 0 });
}

/** Removes the cursor's column. The last remaining column cannot be removed. */
export function deleteColumn(state: EditorState): TransactionSpec | undefined {
  const found = tableAtCursor(state);
  if (!found?.table.regular || (found.table.rows[0]?.length ?? 0) <= 1) {
    return undefined;
  }
  const { table, cursor } = found;
  const keep = (_: unknown, index: number): boolean => index !== cursor.column;
  const rows = table.rows.map((row) => row.filter(keep));
  const alignments = table.alignments.filter(keep);
  const column = Math.min(cursor.column, alignments.length - 1);
  return rewrite(state, table, rows, alignments, { row: cursor.row, column, offset: 0 });
}

/** Sets the alignment of the cursor's column in the delimiter row. */
export function alignColumn(
  state: EditorState,
  alignment: ColumnAlignment,
): TransactionSpec | undefined {
  const found = tableAtCursor(state);
  if (!found?.table.regular) {
    return undefined;
  }
  const { table, cursor } = found;
  const alignments = [...table.alignments];
  alignments[cursor.column] = alignment;
  return rewrite(state, table, table.rows, alignments, cursor);
}

/** Whether the main cursor is in a table that the table tools can edit. */
export function inTable(state: EditorState): boolean {
  return tableAtCursor(state) !== undefined;
}

/** A cell of the table grid: the table by its start, the row (header 0), and the column. */
export interface CellAddress {
  readonly table: number;
  readonly row: number;
  readonly column: number;
}

/** The cell that contains the main cursor, with the cursor's offset in the cell's text. */
export function cellAtCursor(state: EditorState): (CellAddress & { offset: number }) | undefined {
  const found = tableAtCursor(state);
  if (!found) {
    return undefined;
  }
  const { table, cursor } = found;
  return { table: table.from, row: cursor.row, column: cursor.column, offset: cursor.offset };
}

/** The line of a row: the header is the first line, the body rows follow the delimiter row. */
function rowLine(state: EditorState, address: CellAddress) {
  const block = findTables(state).find((table) => table.from === address.table);
  if (!block) {
    return undefined;
  }
  const number = state.doc.lineAt(block.from).number + (address.row === 0 ? 0 : address.row + 1);
  return number <= state.doc.lineAt(block.to).number ? state.doc.line(number) : undefined;
}

/**
 * The source of a cell: its trimmed text and where it is. `undefined` when the row has no such
 * cell, as GFM fills short rows.
 */
export function cellSource(
  state: EditorState,
  address: CellAddress,
): { from: number; to: number; text: string } | undefined {
  const line = rowLine(state, address);
  if (!line) {
    return undefined;
  }
  const { cells, starts } = splitRow(line.text);
  const text = cells[address.column];
  const start = starts[address.column];
  if (text === undefined || start === undefined) {
    return undefined;
  }
  return { from: line.from + start, to: line.from + start + text.length, text };
}

/** The texts of the cells of a table's source, the header first, without the delimiter row. */
export function tableCells(source: string): string[][] {
  return source
    .split(/\r?\n/)
    .filter((_, index) => index !== 1)
    .map((line) => splitRow(line).cells);
}

/** Cell text as Markdown: pipes are escaped and line breaks become spaces. */
export function escapeCell(value: string): string {
  let result = "";
  for (let index = 0; index < value.length; index++) {
    const character = value[index] ?? "";
    if (character === "|" && value[index - 1] !== "\\") {
      result += "\\|";
    } else {
      result += /[\r\n\t]/.test(character) ? " " : character;
    }
  }
  return result;
}

/** The source position for a cursor at `offset` in a cell's text. */
export function cellCursor(state: EditorState, address: CellAddress, offset: number): number {
  const source = cellSource(state, address);
  if (source) {
    return source.from + Math.min(Math.max(offset, 0), source.text.length);
  }
  return rowLine(state, address)?.to ?? address.table;
}

/**
 * Writes the text of a cell typed in the table grid, with the cursor at `caret` in it. Only the
 * cell's text changes, so typing is a small edit; a cell missing from a short row is first
 * added by realigning the table.
 */
export function setCell(
  state: EditorState,
  address: CellAddress,
  value: string,
  caret: number,
): TransactionSpec | undefined {
  const text = escapeCell(value);
  const offset = escapeCell(value.slice(0, caret)).length;
  const source = cellSource(state, address);
  if (source) {
    if (source.text === text) {
      return undefined;
    }
    return {
      changes: { from: source.from, to: source.to, insert: text },
      selection: EditorSelection.cursor(source.from + offset),
      userEvent: "input.type",
    };
  }
  const block = findTables(state).find((table) => table.from === address.table);
  if (!block) {
    return undefined;
  }
  const table = parseTable(state, block.from, block.to);
  const row = table.rows[address.row];
  if (!table.regular || !row || address.column >= row.length) {
    return undefined;
  }
  const rows = table.rows.map((cells) => [...cells]);
  const target = rows[address.row];
  if (target) {
    target[address.column] = text;
  }
  return rewrite(state, table, rows, table.alignments, { ...address, offset }, "", "input.type");
}
