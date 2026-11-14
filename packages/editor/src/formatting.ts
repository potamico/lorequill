import {
  EditorSelection,
  type ChangeSpec,
  type EditorState,
  type TransactionSpec,
} from "@codemirror/state";

/**
 * Formatting commands of the writing toolbar (specification §8). Each returns a transaction, or
 * `undefined` when the selection is ambiguous and nothing is changed. Toggles are syntax-aware: a
 * second invocation removes formatting only when the selection is actually wrapped in it.
 */

export type InlineFormat = "bold" | "italic" | "strikethrough" | "code";
export type BlockFormat =
  "heading1" | "heading2" | "heading3" | "bullet" | "numbered" | "task" | "quote";

const INLINE_MARKERS: Readonly<Record<InlineFormat, string>> = {
  bold: "**",
  italic: "*",
  strikethrough: "~~",
  code: "`",
};

/** Length of the run of `character` ending at `position` (looking left). */
function runBefore(text: string, position: number, character: string): number {
  let length = 0;
  while (position - length - 1 >= 0 && text[position - length - 1] === character) {
    length++;
  }
  return length;
}

function runAfter(text: string, position: number, character: string): number {
  let length = 0;
  while (position + length < text.length && text[position + length] === character) {
    length++;
  }
  return length;
}

/**
 * Whether a run of marker characters contains the marker of `format`. For `*`: italic needs an odd
 * run (1 or 3), bold a run of 2 or 3, so `**bold**` is not italic and `*italic*` is not bold.
 */
function runContains(format: InlineFormat, run: number): boolean {
  switch (format) {
    case "bold":
      return run === 2 || run === 3;
    case "italic":
      return run === 1 || run === 3;
    case "strikethrough":
      return run === 2;
    case "code":
      return run === 1;
  }
}

export function toggleInline(
  state: EditorState,
  format: InlineFormat,
): TransactionSpec | undefined {
  const marker = INLINE_MARKERS[format];
  const character = marker.charAt(0);
  const changes: ChangeSpec[] = [];
  const ranges = [];
  for (const range of state.selection.ranges) {
    const fromLine = state.doc.lineAt(range.from);
    const toLine = state.doc.lineAt(range.to);
    if (fromLine.number !== toLine.number) {
      // Inline formatting across lines is ambiguous; nothing is rewritten.
      return undefined;
    }
    const text = fromLine.text;
    const from = range.from - fromLine.from;
    const to = range.to - fromLine.from;
    const selected = text.slice(from, to);

    // Markers outside the selection: **|text|**
    const outsideBefore = runBefore(text, from, character);
    const outsideAfter = runAfter(text, to, character);
    if (runContains(format, outsideBefore) && runContains(format, outsideAfter)) {
      changes.push(
        { from: range.from - marker.length, to: range.from },
        { from: range.to, to: range.to + marker.length },
      );
      ranges.push(EditorSelection.range(range.from - marker.length, range.to - marker.length));
      continue;
    }
    // Markers inside the selection: |**text**|
    const insideBefore = runAfter(selected, 0, character);
    const insideAfter = runBefore(selected, selected.length, character);
    if (
      selected.length >= marker.length * 2 &&
      runContains(format, insideBefore) &&
      runContains(format, insideAfter) &&
      outsideBefore === 0 &&
      outsideAfter === 0
    ) {
      changes.push(
        { from: range.from, to: range.from + marker.length },
        { from: range.to - marker.length, to: range.to },
      );
      ranges.push(EditorSelection.range(range.from, range.to - marker.length * 2));
      continue;
    }
    if (outsideBefore > 0 || outsideAfter > 0 || insideBefore > 0 || insideAfter > 0) {
      if (character === "*" || character === "~" || character === "`") {
        // Other markers of the same character touch the selection: adding more is ambiguous.
        return undefined;
      }
    }
    changes.push({ from: range.from, insert: marker }, { from: range.to, insert: marker });
    ranges.push(EditorSelection.range(range.from + marker.length, range.to + marker.length));
  }
  return {
    changes,
    selection: EditorSelection.create(ranges, state.selection.mainIndex),
    userEvent: "input.format",
  };
}

const HEADING = /^(#{1,6})[ \t]+/;
const BULLET = /^([ \t]*)[-*+][ \t]+(?!\[[ xX]\][ \t])/;
const TASK = /^([ \t]*)[-*+][ \t]+\[[ xX]\][ \t]+/;
const NUMBERED = /^([ \t]*)\d{1,9}[.)][ \t]+/;
const QUOTE = /^[ \t]{0,3}>[ \t]?/;

interface LineRange {
  readonly from: number;
  readonly text: string;
}

function selectedLines(state: EditorState): LineRange[] {
  const seen = new Set<number>();
  const lines: LineRange[] = [];
  for (const range of state.selection.ranges) {
    const first = state.doc.lineAt(range.from).number;
    // A selection that ends at the start of a line does not include that line.
    const endLine = state.doc.lineAt(range.to);
    const last =
      range.to > range.from && endLine.from === range.to ? endLine.number - 1 : endLine.number;
    for (let number = first; number <= Math.max(first, last); number++) {
      if (!seen.has(number)) {
        seen.add(number);
        const line = state.doc.line(number);
        lines.push({ from: line.from, text: line.text });
      }
    }
  }
  return lines.sort((a, b) => a.from - b.from);
}

/** Removes list and quote prefixes, keeping indentation. Returns the prefix length to remove. */
function listPrefix(text: string): { indent: string; length: number } | undefined {
  const match = TASK.exec(text) ?? BULLET.exec(text) ?? NUMBERED.exec(text);
  return match ? { indent: match[1] ?? "", length: match[0].length } : undefined;
}

export function toggleBlock(state: EditorState, format: BlockFormat): TransactionSpec | undefined {
  const lines = selectedLines(state);
  /** Replaces the `length` characters of the old prefix at `from` with `insert`. */
  const prefixes: { from: number; length: number; insert: string }[] = [];

  if (format === "heading1" || format === "heading2" || format === "heading3") {
    const level = Number(format.slice(-1));
    const all = lines.every((line) => HEADING.exec(line.text)?.[1]?.length === level);
    for (const line of lines) {
      const existing = HEADING.exec(line.text);
      const length = existing ? existing[0].length : 0;
      prefixes.push({ from: line.from, length, insert: all ? "" : `${"#".repeat(level)} ` });
    }
  } else if (format === "quote") {
    const blank = lines.every((line) => line.text.trim() === "");
    const all = !blank && lines.every((line) => QUOTE.test(line.text) || line.text.trim() === "");
    for (const line of lines) {
      const existing = QUOTE.exec(line.text);
      if (all) {
        if (existing) {
          prefixes.push({ from: line.from, length: existing[0].length, insert: "" });
        }
      } else if (!existing) {
        prefixes.push({ from: line.from, length: 0, insert: "> " });
      }
    }
  } else {
    const pattern = format === "bullet" ? BULLET : format === "task" ? TASK : NUMBERED;
    // Blank lines between items are skipped, but a blank line on its own starts a new item.
    const filled = lines.filter((line) => line.text.trim() !== "");
    const content = filled.length > 0 ? filled : lines;
    const all = filled.length > 0 && filled.every((line) => pattern.test(line.text));
    let number = 1;
    for (const line of content) {
      const existing = listPrefix(line.text);
      const indent = existing?.indent ?? /^[ \t]*/.exec(line.text)?.[0] ?? "";
      const length = existing?.length ?? indent.length;
      const marker =
        format === "bullet" ? "- " : format === "task" ? "- [ ] " : `${String(number++)}. `;
      prefixes.push({ from: line.from, length, insert: all ? indent : indent + marker });
    }
  }
  if (prefixes.length === 0) {
    return undefined;
  }
  const changes = state.changes(
    prefixes.map(({ from, length, insert }) => ({ from, to: from + length, insert })),
  );
  // A position at the line start or inside the old prefix lands behind the new one, so writing
  // can start right away (an empty line becomes `# |`, not `|# `).
  const map = (position: number): number => {
    const prefix = prefixes.find((p) => position >= p.from && position <= p.from + p.length);
    return prefix
      ? changes.mapPos(prefix.from, -1) + prefix.insert.length
      : changes.mapPos(position, 1);
  };
  const ranges = state.selection.ranges.map((range) =>
    EditorSelection.range(map(range.anchor), map(range.head)),
  );
  return {
    changes,
    selection: EditorSelection.create(ranges, state.selection.mainIndex),
    userEvent: "input.format",
  };
}

/** Wraps the selected lines in a fenced code block, or removes the fences around them. */
export function toggleCodeBlock(state: EditorState): TransactionSpec {
  const lines = selectedLines(state);
  const first = lines[0];
  const last = lines.at(-1);
  if (!first || !last) {
    return {};
  }
  const firstNumber = state.doc.lineAt(first.from).number;
  const lastNumber = state.doc.lineAt(last.from).number;
  if (firstNumber > 1 && lastNumber < state.doc.lines) {
    const before = state.doc.line(firstNumber - 1);
    const after = state.doc.line(lastNumber + 1);
    if (/^ {0,3}```/.test(before.text) && /^ {0,3}```[ \t]*$/.test(after.text)) {
      return {
        changes: [
          { from: before.from, to: Math.min(before.to + 1, state.doc.length) },
          { from: after.from - 1, to: after.to },
        ],
        userEvent: "input.format",
      };
    }
  }
  const lineBreak = state.lineBreak;
  return {
    changes: [
      { from: first.from, insert: `\`\`\`${lineBreak}` },
      { from: last.from + last.text.length, insert: `${lineBreak}\`\`\`` },
    ],
    // A cursor goes behind the opening fence, ready for the language; a selection stays.
    ...(state.selection.ranges.every((range) => range.empty)
      ? { selection: EditorSelection.cursor(first.from + 3) }
      : {}),
    userEvent: "input.format",
  };
}

/** Inserts a block on its own line at the cursor: a horizontal rule or a table template. */
function insertBlock(state: EditorState, block: string): TransactionSpec {
  const range = state.selection.main;
  const line = state.doc.lineAt(range.head);
  const lineBreak = state.lineBreak;
  const before = line.text.trim() === "" ? "" : lineBreak + lineBreak;
  const insert = `${before}${block}${lineBreak}`;
  const at = line.text.trim() === "" ? line.from : line.to;
  return {
    changes: { from: at, insert },
    // Lengths in CodeMirror count every line break as one character, also for CRLF documents.
    selection: EditorSelection.cursor(at + state.toText(insert).length),
    userEvent: "input.format",
  };
}

export function insertHorizontalRule(state: EditorState): TransactionSpec {
  return insertBlock(state, "---");
}

/** Inserts a two-column table with the given header texts, aligned for readability. */
export function insertTable(
  state: EditorState,
  headers: readonly [string, string] = ["Column 1", "Column 2"],
): TransactionSpec {
  const widths = headers.map((header) => Math.max(3, header.length));
  const row = (cells: readonly string[]): string =>
    `| ${cells.map((cell, index) => cell.padEnd(widths[index] ?? 3)).join(" | ")} |`;
  return insertBlock(
    state,
    [row(headers), row(widths.map((width) => "-".repeat(width))), row(["", ""])].join(
      state.lineBreak,
    ),
  );
}

/**
 * Inserts a link with the selection as its text and selects the destination placeholder. The
 * Insert Link dialog with page search is the extension's `lorequill.insertLink` command.
 */
export function insertLink(state: EditorState, destination = "page.md"): TransactionSpec {
  const range = state.selection.main;
  const text = state.sliceDoc(range.from, range.to) || "Link";
  const insert = `[${text}](${destination})`;
  const destinationStart = range.from + text.length + 3;
  return {
    changes: { from: range.from, to: range.to, insert },
    selection: EditorSelection.range(destinationStart, destinationStart + destination.length),
    userEvent: "input.format",
  };
}

/**
 * Replaces the selection with a link to a page chosen by Insert Link (§10). `text` is the display
 * text the author confirmed; brackets and backslashes in it are escaped so it stays one link. The
 * cursor ends after the link.
 */
export function insertPageLink(
  state: EditorState,
  text: string,
  destination: string,
): TransactionSpec {
  const range = state.selection.main;
  const label = text
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[\\[\]]/g, (character) => `\\${character}`);
  const insert = `[${label}](${destination})`;
  return {
    changes: { from: range.from, to: range.to, insert },
    selection: EditorSelection.cursor(range.from + insert.length),
    userEvent: "input.format",
  };
}

/**
 * Toggles the task-list checkbox whose marker (`[ ]`, `[x]`, or `[X]`) starts at `from`: a single
 * character changes, so the toggle is one small undoable edit (§8). `undefined` if there is no
 * marker at `from`.
 */
export function toggleTask(state: EditorState, from: number): TransactionSpec | undefined {
  const marker = state.sliceDoc(from, from + 3);
  if (!/^\[[ xX]\]$/.test(marker)) {
    return undefined;
  }
  return {
    changes: { from: from + 1, to: from + 2, insert: marker[1] === " " ? "x" : " " },
    userEvent: "input.toggle",
  };
}
