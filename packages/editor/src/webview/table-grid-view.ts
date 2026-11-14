import { EditorSelection, Prec, type EditorState, type TransactionSpec } from "@codemirror/state";
import { keymap, type EditorView, WidgetType } from "@codemirror/view";
import { renderPreview } from "../render";
import {
  cellAtCursor,
  cellCursor,
  cellSource,
  escapeCell,
  formatTable,
  nextCell,
  previousCell,
  setCell,
  tableCells,
  tableEnter,
  type CellAddress,
} from "../table-edit";
import { findTables } from "../table-grid";

/**
 * The editable table grid of `Edit` (specification §8). A table stays a grid while it is edited:
 * a cell shows its rendered content, and the cell being edited shows its Markdown text in a
 * one-line input. Every keystroke writes the cell's text into the document, so save, VS Code's
 * undo, and the checks keep working on the Markdown; the cursor of the editor follows the cell.
 * Leaving a cell realigns the table's source.
 */

const INPUT_CLASS = "cm-lq-cell-input";

/** Where a grid's table starts in the document; the widget may have moved since it was drawn. */
function tableOf(view: EditorView, grid: HTMLElement): number | undefined {
  const from = view.posAtDOM(grid);
  return findTables(view.state).some((table) => table.from === from) ? from : undefined;
}

function cellsOf(grid: HTMLElement): HTMLTableCellElement[][] {
  return Array.from(grid.querySelectorAll("tr")).map((row) =>
    Array.from(row.querySelectorAll<HTMLTableCellElement>("th, td")),
  );
}

function addressOf(
  view: EditorView,
  grid: HTMLElement,
  cell: HTMLTableCellElement,
): CellAddress | undefined {
  const table = tableOf(view, grid);
  const row = cellsOf(grid).findIndex((cells) => cells.includes(cell));
  if (table === undefined || row < 0) {
    return undefined;
  }
  return { table, row, column: cell.cellIndex };
}

function render(source: string): HTMLTableCellElement[][] {
  const template = document.createElement("div");
  // Sanitized by the renderer: no raw HTML, scripts, or remote content (§15).
  template.innerHTML = renderPreview(source);
  return cellsOf(template);
}

/** Shows a cell's rendered content, with the alignment the renderer gave it. */
function showRendered(cell: HTMLTableCellElement, rendered: HTMLTableCellElement): void {
  cell.innerHTML = rendered.innerHTML;
  const style = rendered.getAttribute("style");
  if (style === null) {
    cell.removeAttribute("style");
  } else {
    cell.setAttribute("style", style);
  }
}

/** The input of a cell that is being edited, if any. */
function activeInput(cell: Element): HTMLInputElement | null {
  return cell.querySelector<HTMLInputElement>(`input.${INPUT_CLASS}`);
}

/**
 * Brings the grid up to date with its source. Cells keep their DOM where the table's shape is
 * unchanged, so the cell being edited keeps its focus and caret; its text is only replaced when
 * the document changed it from elsewhere, for example by undo.
 */
function refresh(grid: HTMLElement, source: string): void {
  const rendered = render(source);
  const current = cellsOf(grid);
  const sameShape =
    rendered.length === current.length &&
    rendered.every((row, index) => row.length === current[index]?.length);
  if (!sameShape) {
    grid.innerHTML = renderPreview(source);
    return;
  }
  const texts = tableCells(source);
  current.forEach((row, rowIndex) => {
    row.forEach((cell, column) => {
      const input = activeInput(cell);
      const text = texts[rowIndex]?.[column] ?? "";
      if (input && document.activeElement === input) {
        if (escapeCell(input.value).trim() !== text) {
          input.value = text;
        }
        return;
      }
      const fresh = rendered[rowIndex]?.[column];
      if (fresh) {
        showRendered(cell, fresh);
      }
    });
  });
}

/** Runs a table command with the cursor in a cell, as if the cursor had been placed there. */
function runAt(
  view: EditorView,
  address: CellAddress,
  offset: number,
  command: (state: EditorState) => TransactionSpec | undefined,
): void {
  const anchor = cellCursor(view.state, address, offset);
  const state = view.state.update({ selection: EditorSelection.cursor(anchor) }).state;
  const spec = command(state);
  view.dispatch({ selection: EditorSelection.cursor(anchor) });
  if (spec) {
    view.dispatch(spec);
  }
}

/** Puts the editor cursor before or after the table and gives the editor the focus. */
function leave(view: EditorView, address: CellAddress, where: "before" | "after"): void {
  const block = findTables(view.state).find((table) => table.from === address.table);
  if (!block) {
    view.focus();
    return;
  }
  const line =
    where === "before"
      ? view.state.doc.lineAt(block.from).number - 1
      : view.state.doc.lineAt(block.to).number + 1;
  const anchor =
    line < 1
      ? block.from
      : line > view.state.doc.lines
        ? block.to
        : where === "before"
          ? view.state.doc.line(line).to
          : view.state.doc.line(line).from;
  view.dispatch({ selection: EditorSelection.cursor(anchor), scrollIntoView: true });
  view.focus();
}

/** Turns a cell into a one-line input with its Markdown text and focuses it. */
function edit(
  view: EditorView,
  grid: HTMLElement,
  cell: HTMLTableCellElement,
  caret: number | "end",
): void {
  const address = addressOf(view, grid, cell);
  if (!address) {
    return;
  }
  const existing = activeInput(cell);
  if (existing) {
    existing.focus();
    return;
  }
  // Only one cell is edited at a time: the previous one is finished first.
  for (const other of grid.querySelectorAll<HTMLInputElement>(`input.${INPUT_CLASS}`)) {
    const previous = other.closest<HTMLTableCellElement>("td, th");
    if (previous) {
      done(view, grid, previous);
    }
  }
  const text = cellSource(view.state, address)?.text ?? "";
  const input = document.createElement("input");
  input.type = "text";
  input.className = INPUT_CLASS;
  input.value = text;
  input.spellcheck = true;
  input.setAttribute("aria-label", cellLabel(grid, address));
  input.size = Math.max(text.length, 1);
  cell.replaceChildren(input);
  input.focus();
  const position = caret === "end" ? text.length : Math.min(caret, text.length);
  input.setSelectionRange(position, position);
  followCaret(view, grid, cell, input);

  input.addEventListener("input", () => {
    const current = addressOf(view, grid, cell);
    const spec = current
      ? setCell(view.state, current, input.value, input.selectionStart ?? input.value.length)
      : undefined;
    input.size = Math.max(input.value.length, 1);
    if (spec) {
      view.dispatch(spec);
    }
  });
  for (const type of ["keyup", "mouseup", "select"]) {
    input.addEventListener(type, () => {
      followCaret(view, grid, cell, input);
    });
  }
  input.addEventListener("keydown", (event) => {
    onKey(view, grid, cell, input, event);
  });
  input.addEventListener("blur", () => {
    // Deferred: the blur may come from a focus change inside an editor update.
    setTimeout(() => {
      if (!input.isConnected || document.activeElement === input) {
        return;
      }
      done(view, grid, cell);
    }, 0);
  });
}

/** "Column header, row 2" style label for the input: the column's header text and the row. */
function cellLabel(grid: HTMLElement, address: CellAddress): string {
  const header = cellsOf(grid)[0]?.[address.column]?.textContent.trim() ?? "";
  return address.row === 0 ? header : `${header} ${String(address.row)}`.trim();
}

/** The editor cursor follows the caret in the cell, so the table tools act on this cell. */
function followCaret(
  view: EditorView,
  grid: HTMLElement,
  cell: HTMLTableCellElement,
  input: HTMLInputElement,
): void {
  const address = addressOf(view, grid, cell);
  if (!address) {
    return;
  }
  const offset = escapeCell(input.value.slice(0, input.selectionStart ?? 0)).length;
  const anchor = cellCursor(view.state, address, offset);
  if (view.state.selection.main.head !== anchor || !view.state.selection.main.empty) {
    view.dispatch({ selection: EditorSelection.cursor(anchor) });
  }
}

/** Leaving a cell shows its rendered content again and realigns the table. */
function done(view: EditorView, grid: HTMLElement, cell: HTMLTableCellElement): void {
  const address = addressOf(view, grid, cell);
  if (!address) {
    return;
  }
  const offset = cellSource(view.state, address)?.text.length ?? 0;
  const anchor = cellCursor(view.state, address, offset);
  const state = view.state.update({ selection: EditorSelection.cursor(anchor) }).state;
  const spec = formatTable(state);
  if (spec?.changes) {
    // Only the text changes; the cursor is placed by the cell that is edited next, if any.
    view.dispatch({ changes: spec.changes, userEvent: "input.format" });
  }
  // The cell shows its rendered content again, even while its input still has the focus.
  const block = findTables(view.state).find((table) => table.from === address.table);
  const fresh = block
    ? render(view.state.sliceDoc(block.from, block.to))[address.row]?.[address.column]
    : undefined;
  if (fresh && cell.isConnected) {
    showRendered(cell, fresh);
  }
}

function onKey(
  view: EditorView,
  grid: HTMLElement,
  cell: HTMLTableCellElement,
  input: HTMLInputElement,
  event: KeyboardEvent,
): void {
  const address = addressOf(view, grid, cell);
  if (!address || event.isComposing) {
    return;
  }
  const caret = input.selectionStart ?? 0;
  const offset = escapeCell(input.value.slice(0, caret)).length;
  const atStart = caret === 0 && input.selectionEnd === 0;
  const atEnd = caret === input.value.length && input.selectionEnd === input.value.length;
  const modifier = event.ctrlKey || event.metaKey || event.altKey;
  const move = (command: (state: EditorState) => TransactionSpec | undefined): void => {
    runAt(view, address, offset, command);
    if (!focusTableCell(view)) {
      view.focus();
    }
  };
  const rows = cellsOf(grid);
  if (event.key === "Tab" && !modifier) {
    move(event.shiftKey ? previousCell : nextCell);
  } else if (event.key === "Enter" && !modifier && !event.shiftKey) {
    move(tableEnter);
  } else if (event.key === "Escape") {
    leave(view, address, "after");
  } else if (event.key === "ArrowUp" && !modifier) {
    const above = rows[address.row - 1]?.[address.column];
    if (above) {
      edit(view, grid, above, caret);
    } else {
      leave(view, address, "before");
    }
  } else if (event.key === "ArrowDown" && !modifier) {
    const below = rows[address.row + 1]?.[address.column];
    if (below) {
      edit(view, grid, below, caret);
    } else {
      leave(view, address, "after");
    }
  } else if (event.key === "ArrowLeft" && atStart && !modifier && !event.shiftKey) {
    const before =
      rows[address.row]?.[address.column - 1] ?? rows[address.row - 1]?.at(-1) ?? undefined;
    if (!before) {
      return;
    }
    edit(view, grid, before, "end");
  } else if (event.key === "ArrowRight" && atEnd && !modifier && !event.shiftKey) {
    const after = rows[address.row]?.[address.column + 1] ?? rows[address.row + 1]?.[0];
    if (!after) {
      return;
    }
    edit(view, grid, after, 0);
  } else if ((event.ctrlKey || event.metaKey) && /^[zy]$/i.test(event.key)) {
    // Undo and redo belong to the VS Code document (§7), not to the input's own history; the
    // key still reaches VS Code's keybindings.
  } else {
    return;
  }
  event.preventDefault();
}

/**
 * Focuses the grid cell that contains the editor cursor, with the caret at the cursor's place.
 * False when the cursor is not in a table shown as a grid.
 */
export function focusTableCell(view: EditorView): boolean {
  const cursor = cellAtCursor(view.state);
  if (!cursor) {
    return false;
  }
  for (const grid of view.contentDOM.querySelectorAll<HTMLElement>(".cm-lq-table")) {
    if (tableOf(view, grid) === cursor.table) {
      const cell = cellsOf(grid)[cursor.row]?.[cursor.column];
      if (cell) {
        edit(view, grid, cell, cursor.offset);
        return true;
      }
    }
  }
  return false;
}

/**
 * A table shown as an editable grid. A click on a cell edits it; Ctrl+click on a link opens it.
 */
export class TableGridWidget extends WidgetType {
  constructor(
    private readonly source: string,
    private readonly rows: number,
    private readonly onOpenLink: (target: string) => void,
  ) {
    super();
  }
  override eq(other: TableGridWidget): boolean {
    return other.source === this.source;
  }
  override get estimatedHeight(): number {
    return this.rows * 30;
  }
  toDOM(view: EditorView): HTMLElement {
    const grid = document.createElement("div");
    grid.className = "cm-lq-table";
    grid.innerHTML = renderPreview(this.source);
    grid.addEventListener("mousedown", (event) => {
      if (event.button !== 0 || !(event.target instanceof Element)) {
        return;
      }
      if (event.target.closest(`input.${INPUT_CLASS}`)) {
        return;
      }
      const link = event.target.closest<HTMLElement>("[data-lq-href]");
      const target = link?.dataset.lqHref;
      if ((event.ctrlKey || event.metaKey) && target) {
        event.preventDefault();
        this.onOpenLink(target);
        return;
      }
      const cell = event.target.closest<HTMLTableCellElement>("td, th");
      if (cell) {
        event.preventDefault();
        edit(view, grid, cell, "end");
      }
    });
    return grid;
  }
  override updateDOM(dom: HTMLElement): boolean {
    refresh(dom, this.source);
    return true;
  }
  override ignoreEvent(): boolean {
    return true;
  }
}

/**
 * ArrowDown on the line above a grid and ArrowUp on the line below it move into its first cell
 * or the first cell of its last row; the editor's cursor would otherwise jump over the table.
 */
export const enterTable = Prec.high(
  keymap.of([
    { key: "ArrowDown", run: (view) => enter(view, "down") },
    { key: "ArrowUp", run: (view) => enter(view, "up") },
  ]),
);

function enter(view: EditorView, direction: "up" | "down"): boolean {
  const range = view.state.selection.main;
  if (!range.empty) {
    return false;
  }
  const line = view.state.doc.lineAt(range.head).number;
  const table = findTables(view.state).find((candidate) =>
    direction === "down"
      ? view.state.doc.lineAt(candidate.from).number === line + 1
      : view.state.doc.lineAt(candidate.to).number === line - 1,
  );
  if (!table) {
    return false;
  }
  const address = {
    table: table.from,
    row: direction === "down" ? 0 : table.cells.length - 1,
    column: 0,
  };
  view.dispatch({ selection: EditorSelection.cursor(cellCursor(view.state, address, 0)) });
  return focusTableCell(view);
}
