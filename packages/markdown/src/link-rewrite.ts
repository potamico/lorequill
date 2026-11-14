import { relativeLinkPath } from "./link-path";
import { resolveLinkDestination } from "./link-target";
import { visit } from "./links";
import { parseMarkdown } from "./parse";
import type { TextEdit } from "./text-edit";

/** A file or directory that moved, as POSIX paths relative to the content root. */
export interface PathMove {
  readonly from: string;
  readonly to: string;
}

/** Where `path` is after `moves`: a moved file, or a path below a moved directory. */
export function movedPath(path: string, moves: readonly PathMove[]): string {
  for (const { from, to } of moves) {
    if (path === from) {
      return to;
    }
    if (path.startsWith(`${from}/`)) {
      return `${to}${path.slice(from.length)}`;
    }
  }
  return path;
}

/** Where `path`, a path after `moves`, was before them: the inverse of {@link movedPath}. */
export function originalPath(path: string, moves: readonly PathMove[]): string {
  return movedPath(
    path,
    moves.map(({ from, to }) => ({ from: to, to: from })),
  );
}

/**
 * The edits that keep the relative links and images of a page pointing at the same files after
 * `moves` (specification §10): links to a moved file or directory, and every relative link of the
 * page itself when it moved. `sourcePath` is the page's path before the move.
 *
 * Only the destination is replaced; the link text, title, query, and fragment stay as written,
 * and a destination in angle brackets keeps them. Links that still resolve to the same file, and
 * external, same-page, and invalid destinations are left alone. Raw HTML is not interpreted.
 */
export function rewriteLinksForMoves(
  text: string,
  sourcePath: string,
  moves: readonly PathMove[],
): TextEdit[] {
  const newSource = movedPath(sourcePath, moves);
  const document = parseMarkdown(text);
  const edits: TextEdit[] = [];
  visit(document.root, (node) => {
    if (node.type !== "link" && node.type !== "image" && node.type !== "definition") {
      return;
    }
    const start = node.position?.start.offset;
    const end = node.position?.end.offset;
    if (start === undefined || end === undefined) {
      return;
    }
    const old = resolveLinkDestination(sourcePath, node.url);
    if (old.kind !== "path") {
      return;
    }
    const target = movedPath(old.path, moves);
    const now = resolveLinkDestination(newSource, node.url);
    if (now.kind === "path" && now.path === target) {
      return;
    }
    const span =
      node.type === "definition"
        ? definitionDestination(document.text, start, end)
        : inlineDestination(document.text, start, end);
    if (!span) {
      return;
    }
    edits.push({
      ...span,
      newText: rewritten(document.text.slice(span.start, span.end), newSource, target),
    });
  });
  return edits;
}

/** The new destination: the relative path to `target`, with the old query and fragment. */
function rewritten(raw: string, source: string, target: string): string {
  const angle = raw.startsWith("<") && raw.endsWith(">");
  const inner = angle ? raw.slice(1, -1) : raw;
  const cut = inner.search(/[?#]/);
  const suffix = cut === -1 ? "" : inner.slice(cut);
  let path = target === "." ? "./" : relativeLinkPath(source, target);
  if (inner.startsWith("./") && !path.startsWith(".")) {
    path = `./${path}`;
  }
  return angle ? `<${path}${suffix}>` : `${path}${suffix}`;
}

interface Span {
  readonly start: number;
  readonly end: number;
}

/** The destination of `[text](destination "title")` or `![alt](...)` between `start` and `end`. */
function inlineDestination(text: string, start: number, end: number): Span | undefined {
  if (text.charAt(end - 1) !== ")") {
    return undefined;
  }
  // The link text may contain `](` only inside code or escapes; try each opener in turn.
  for (let opener = text.indexOf("](", start); opener !== -1 && opener < end;) {
    const destination = readDestination(text, skipSpace(text, opener + 2, end), end);
    if (destination && closes(text, destination.end, end - 1)) {
      return destination;
    }
    opener = text.indexOf("](", opener + 1);
  }
  return undefined;
}

/** The destination of a reference definition `[label]: destination "title"`. */
function definitionDestination(text: string, start: number, end: number): Span | undefined {
  let index = start + 1;
  while (index < end) {
    const character = text.charAt(index);
    if (character === "\\") {
      index += 2;
      continue;
    }
    if (character === "]") {
      break;
    }
    index++;
  }
  if (text.charAt(index + 1) !== ":") {
    return undefined;
  }
  return readDestination(text, skipSpace(text, index + 2, end), end);
}

function skipSpace(text: string, index: number, end: number): number {
  let position = index;
  while (position < end && /\s/.test(text.charAt(position))) {
    position++;
  }
  return position;
}

/** A link destination starting at `index`: `<...>`, or a run without spaces and with balanced parentheses. */
function readDestination(text: string, index: number, end: number): Span | undefined {
  if (text.charAt(index) === "<") {
    for (let position = index + 1; position < end; position++) {
      const character = text.charAt(position);
      if (character === "\\") {
        position++;
      } else if (character === ">") {
        return { start: index, end: position + 1 };
      } else if (character === "<" || character === "\n") {
        return undefined;
      }
    }
    return undefined;
  }
  let depth = 0;
  let position = index;
  while (position < end) {
    const character = text.charAt(position);
    if (character === "\\") {
      position += 2;
      continue;
    }
    if (/\s/.test(character)) {
      break;
    }
    if (character === "(") {
      depth++;
    } else if (character === ")") {
      if (depth === 0) {
        break;
      }
      depth--;
    }
    position++;
  }
  return position === index ? undefined : { start: index, end: position };
}

/** Whether only an optional title and spaces follow `index` up to the closing parenthesis. */
function closes(text: string, index: number, close: number): boolean {
  let position = skipSpace(text, index, close);
  const quote = text.charAt(position);
  if (position < close && (quote === '"' || quote === "'" || quote === "(")) {
    const closer = quote === "(" ? ")" : quote;
    position++;
    while (position < close && text.charAt(position) !== closer) {
      position += text.charAt(position) === "\\" ? 2 : 1;
    }
    if (position >= close) {
      return false;
    }
    position = skipSpace(text, position + 1, close);
  }
  return position === close;
}
