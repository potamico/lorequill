import type { CompletionItem } from "./protocol";

const LETTER_OR_DIGIT = /[\p{L}\p{N}]/u;

/** Normalizes text for matching like the Pages filter: Unicode NFC, locale-independent lower case. */
function normalize(text: string): string {
  return text.normalize("NFC").toLowerCase();
}

/**
 * How well `text` contains `needle`: 0 at the start, 1 at the start of a word (after a character
 * that is not a letter or digit, such as `/`, `-`, or a space), 2 anywhere else.
 */
function rank(text: string, needle: string): number | undefined {
  const haystack = normalize(text);
  let index = haystack.indexOf(needle);
  if (index === -1) {
    return undefined;
  }
  if (index === 0) {
    return 0;
  }
  while (index !== -1) {
    if (!LETTER_OR_DIGIT.test(haystack.slice(0, index).at(-1) ?? "")) {
      return 1;
    }
    index = haystack.indexOf(needle, index + 1);
  }
  return 2;
}

/**
 * The completion items that match the typed text (specification §8): the text occurs in the
 * destination, the description (page title or heading text), or a keyword (page alias), ignoring
 * case. Matches at the start come first, then matches at a word start, then the rest; within a
 * group the items keep their order. Empty text matches every item.
 */
export function matchCompletions(
  items: readonly CompletionItem[],
  typed: string,
): CompletionItem[] {
  const needle = normalize(typed);
  if (needle === "") {
    return [...items];
  }
  const ranked: { item: CompletionItem; index: number; score: number }[] = [];
  items.forEach((item, index) => {
    let score = Infinity;
    for (const text of [item.label, item.detail ?? "", ...(item.keywords ?? [])]) {
      score = Math.min(score, rank(text, needle) ?? Infinity);
    }
    if (score !== Infinity) {
      ranked.push({ item, index, score });
    }
  });
  return ranked.sort((a, b) => a.score - b.score || a.index - b.index).map(({ item }) => item);
}
