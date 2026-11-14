export type LineEnding = "\n" | "\r\n";

export interface Line {
  /** Line content without its line ending. */
  readonly content: string;
  /** Offset of the first character after this line (and its line ending). */
  readonly next: number;
  /** Whether the line is terminated by a line ending. */
  readonly terminated: boolean;
  /** Whether the line ending is CRLF. */
  readonly crlf: boolean;
}

/**
 * Reads the line starting at `from`. Lines end with LF or CRLF; a lone CR is ordinary content,
 * because VS Code normalizes line endings of a document to LF or CRLF.
 */
export function readLine(text: string, from: number): Line {
  const newline = text.indexOf("\n", from);
  if (newline === -1) {
    return { content: text.slice(from), next: text.length, terminated: false, crlf: false };
  }
  const crlf = newline > from && text[newline - 1] === "\r";
  return {
    content: text.slice(from, crlf ? newline - 1 : newline),
    next: newline + 1,
    terminated: true,
    crlf,
  };
}

/** The line ending of the first line break in the text; LF when there is none. */
export function detectLineEnding(text: string): LineEnding {
  const newline = text.indexOf("\n");
  return newline > 0 && text[newline - 1] === "\r" ? "\r\n" : "\n";
}

/** 1-based line number of the given offset. */
export function lineNumberAt(text: string, offset: number): number {
  let line = 1;
  let index = text.indexOf("\n");
  while (index !== -1 && index < offset) {
    line++;
    index = text.indexOf("\n", index + 1);
  }
  return line;
}
