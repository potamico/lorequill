import { readLine } from "./lines";

/** The kind of a Material for MkDocs container block. */
export type ContainerKind = "admonition" | "details" | "tab";

/** One body line of a container, with the information needed to map positions back. */
export interface ContainerBodyLine {
  /** Offset of the start of the line in the scanned text. */
  readonly lineStart: number;
  /** Number of characters removed from the start of the line (the container indentation). */
  readonly removed: number;
  /** Line content after the removed indentation, without the line ending. */
  readonly content: string;
}

/** A container block found in a text, with its body lines de-indented. */
export interface ContainerBlock {
  readonly kind: ContainerKind;
  /** The marker as written: `!!!`, `???`, `???+`, `===`, `===+`, `===!`, or `===+!`. */
  readonly marker: string;
  /** The admonition type, such as `note`; absent for content tabs. */
  readonly type?: string;
  /** The quoted title, if any. */
  readonly title?: string;
  /** Indentation of the marker line in columns. */
  readonly indent: number;
  /** Offset of the start of the marker line. */
  readonly start: number;
  /** Offset after the last line of the block (header or body), excluding its line ending. */
  readonly end: number;
  readonly body: readonly ContainerBodyLine[];
}

// `!!! type "Title"` and `??? type "Title"` follow the admonition and details extensions: a type
// word is required, the title is optional. Content tabs require a quoted title (`=== "Tab"`), which
// also keeps a setext underline (`===`) from being mistaken for a tab.
export const ADMONITION_MARKER =
  /^(!!!|\?\?\?\+?)[ \t]*([\w-]+(?:[ \t]+[\w-]+)*)(?:[ \t]+"(.*?)")?[ \t]*$/;
const TAB = /^(===[+!]{0,2})[ \t]+"(.*?)"[ \t]*$/;
const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})(.*)$/;
const FENCE_CLOSE = /^ {0,3}(`{3,}|~{3,})[ \t]*$/;
const LIST_ITEM = /^[ \t]*(?:[-*+]|\d{1,9}[.)])(?:[ \t]|$)/;

const TAB_WIDTH = 4;

interface ScannedLine {
  readonly start: number;
  readonly content: string;
  readonly indent: number;
  readonly blank: boolean;
}

/**
 * Finds the outermost Material for MkDocs container blocks of a text: admonitions (`!!!`),
 * collapsible blocks (`???`, `???+`), and content tabs (`===`). Nested containers stay inside the
 * body of their parent and are found when the body is scanned.
 *
 * A body consists of the following lines that are blank or indented by at least four columns
 * more than the marker. Trailing blank lines are not part of the body. Markers inside fenced code
 * blocks are ignored. A marker indented by four or more columns only counts inside a list item;
 * elsewhere such a line is an indented code block.
 */
export function findContainers(text: string): ContainerBlock[] {
  const lines = scanLines(text);
  const containers: ContainerBlock[] = [];
  let fence: { char: string; length: number } | undefined;

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    if (!line) {
      continue;
    }
    if (fence) {
      const closing = FENCE_CLOSE.exec(line.content)?.[1];
      if (closing?.startsWith(fence.char) && closing.length >= fence.length) {
        fence = undefined;
      }
      continue;
    }
    const opening = FENCE_OPEN.exec(line.content);
    if (opening?.[1] && !(opening[1].startsWith("`") && opening[2]?.includes("`"))) {
      fence = { char: opening[1].charAt(0), length: opening[1].length };
      continue;
    }

    const header = parseHeader(line.content.trimStart());
    if (!header || (line.indent >= TAB_WIDTH && !insideListItem(lines, index))) {
      continue;
    }

    const bodyIndent = line.indent + TAB_WIDTH;
    let last = index;
    let scan = index + 1;
    while (scan < lines.length) {
      const candidate = lines[scan];
      if (!candidate || !(candidate.blank || candidate.indent >= bodyIndent)) {
        break;
      }
      if (!candidate.blank) {
        last = scan;
      }
      scan++;
    }

    const body: ContainerBodyLine[] = [];
    for (let bodyIndex = index + 1; bodyIndex <= last; bodyIndex++) {
      const bodyLine = lines[bodyIndex];
      if (bodyLine) {
        const removed = charactersForColumns(bodyLine.content, bodyIndent);
        body.push({
          lineStart: bodyLine.start,
          removed,
          content: bodyLine.content.slice(removed),
        });
      }
    }
    const lastLine = lines[last] ?? line;
    containers.push({
      ...header,
      indent: line.indent,
      start: line.start,
      end: lastLine.start + lastLine.content.length,
      body,
    });
    index = last;
  }
  return containers;
}

function parseHeader(
  content: string,
): Pick<ContainerBlock, "kind" | "marker" | "type" | "title"> | undefined {
  const admonition = ADMONITION_MARKER.exec(content);
  if (admonition?.[1] && admonition[2]) {
    const marker = admonition[1];
    return {
      kind: marker === "!!!" ? "admonition" : "details",
      marker,
      type: admonition[2],
      ...(admonition[3] === undefined ? {} : { title: admonition[3] }),
    };
  }
  const tab = TAB.exec(content);
  if (tab?.[1] && tab[2] !== undefined) {
    return { kind: "tab", marker: tab[1], title: tab[2] };
  }
  return undefined;
}

/** Whether the closest preceding non-blank line with less indentation is a list item. */
function insideListItem(lines: readonly ScannedLine[], index: number): boolean {
  const indent = lines[index]?.indent ?? 0;
  for (let scan = index - 1; scan >= 0; scan--) {
    const line = lines[scan];
    if (line && !line.blank && line.indent < indent) {
      return LIST_ITEM.test(line.content);
    }
  }
  return false;
}

function scanLines(text: string): ScannedLine[] {
  const lines: ScannedLine[] = [];
  let position = 0;
  while (position < text.length) {
    const line = readLine(text, position);
    lines.push({
      start: position,
      content: line.content,
      indent: indentationWidth(line.content),
      blank: line.content.trim() === "",
    });
    position = line.next;
  }
  return lines;
}

function indentationWidth(content: string): number {
  let width = 0;
  for (const character of content) {
    if (character === " ") {
      width++;
    } else if (character === "\t") {
      width += TAB_WIDTH - (width % TAB_WIDTH);
    } else {
      break;
    }
  }
  return width;
}

/** Number of leading whitespace characters that cover at least `columns` columns. */
function charactersForColumns(content: string, columns: number): number {
  let width = 0;
  let count = 0;
  while (width < columns && count < content.length) {
    const character = content[count];
    if (character === " ") {
      width++;
    } else if (character === "\t") {
      width += TAB_WIDTH - (width % TAB_WIDTH);
    } else {
      break;
    }
    count++;
  }
  return count;
}
