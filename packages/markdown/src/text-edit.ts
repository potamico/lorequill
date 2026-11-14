/** A replacement of the UTF-16 code unit range [start, end) of a text. */
export interface TextEdit {
  readonly start: number;
  readonly end: number;
  readonly newText: string;
}

/** Applies non-overlapping edits to a text. Offsets refer to the original text. */
export function applyTextEdits(text: string, edits: readonly TextEdit[]): string {
  const ordered = [...edits].sort((a, b) => b.start - a.start);
  let result = text;
  for (const edit of ordered) {
    result = result.slice(0, edit.start) + edit.newText + result.slice(edit.end);
  }
  return result;
}
