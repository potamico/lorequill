import { readLine, type LineEnding } from "./lines";

/**
 * The location of the front matter block in a Markdown text. All offsets are UTF-16 code unit
 * offsets into the original text, so a caller can replace parts of the block without touching
 * anything else.
 *
 *     ---              <- start
 *     title: Example   <- contentStart ... contentEnd
 *     ---
 *     Body             <- end
 */
export interface FrontMatterBlock {
  /** Start of the opening delimiter line. */
  readonly start: number;
  /** First character after the closing delimiter line and its line ending. */
  readonly end: number;
  /** First character after the opening delimiter line and its line ending. */
  readonly contentStart: number;
  /** Start of the closing delimiter line. The YAML is `text.slice(contentStart, contentEnd)`. */
  readonly contentEnd: number;
  /** Line ending of the opening delimiter line, used when writing new front matter lines. */
  readonly eol: LineEnding;
}

const DELIMITER = /^---[ \t]*$/;

/**
 * Finds the front matter block: a line `---` at the very start of the text (after an optional byte
 * order mark), followed by YAML, closed by the next line `---`.
 *
 * Text without a closing delimiter has no front matter. A document that begins with a thematic
 * break and contains a second one later is indistinguishable from front matter; its YAML is then
 * reported as invalid by `readFrontMatter`, which is why the properties panel stays read-only.
 */
export function findFrontMatter(text: string): FrontMatterBlock | undefined {
  const start = text.startsWith("\uFEFF") ? 1 : 0;
  const opening = readLine(text, start);
  if (!opening.terminated || !DELIMITER.test(opening.content)) {
    return undefined;
  }

  let position = opening.next;
  while (position < text.length) {
    const line = readLine(text, position);
    if (DELIMITER.test(line.content)) {
      return {
        start,
        end: line.next,
        contentStart: opening.next,
        contentEnd: position,
        eol: opening.crlf ? "\r\n" : "\n",
      };
    }
    position = line.next;
  }
  return undefined;
}

/** Offset of the first character after the front matter, or 0 when there is none. */
export function bodyStart(text: string): number {
  return findFrontMatter(text)?.end ?? 0;
}
