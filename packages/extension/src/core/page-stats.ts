/** Counts words of the page body (front matter excluded) for the status bar. */
export function countWords(text: string): number {
  const body = text
    .replace(/^\uFEFF?---[ \t]*\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/, "")
    // Task markers such as "[x]" are syntax, not words.
    .replace(/\[[ xX]\]/g, "");
  return body.match(/[\p{L}\p{N}][\p{L}\p{N}'’_-]*/gu)?.length ?? 0;
}

/** Reading time in minutes at 200 words per minute, at least 1 for a non-empty page. */
export function readingMinutes(words: number): number {
  return words === 0 ? 0 : Math.max(1, Math.round(words / 200));
}
