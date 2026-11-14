import type { MarkdownConfig } from "@lezer/markdown";

/**
 * Strikethrough with a single tilde (`~text~`) for the CodeMirror Markdown parser. GFM strikes
 * through text between one or two tildes, and micromark, which the preview and the checks use,
 * accepts both; the GFM extension of `@lezer/markdown` accepts only two. With this extension the
 * editor shows a single-tilde span as struck through, as the preview does.
 *
 * The span becomes the same `Strikethrough` and `StrikethroughMark` nodes as a double-tilde span,
 * so highlighting and the live preview treat both alike. A separate delimiter type keeps the
 * lengths apart: `~a~~` is not a strikethrough, as in GFM. Runs of three or more tildes are left
 * alone. The flanking rules are those of the double-tilde parser and of micromark.
 */

const TILDE = 126;
const SingleTildeDelimiter = { resolve: "Strikethrough", mark: "StrikethroughMark" };
const PUNCTUATION = /[\p{P}\p{S}]/u;
const SPACE = /\s|^$/;

export const singleTildeStrikethrough: MarkdownConfig = {
  parseInline: [
    {
      name: "SingleTildeStrikethrough",
      parse(cx, next, pos) {
        if (next !== TILDE || cx.char(pos + 1) === TILDE || cx.char(pos - 1) === TILDE) {
          return -1;
        }
        const before = cx.slice(pos - 1, pos);
        const after = cx.slice(pos + 1, pos + 2);
        const spaceBefore = SPACE.test(before);
        const spaceAfter = SPACE.test(after);
        const punctuationBefore = PUNCTUATION.test(before);
        const punctuationAfter = PUNCTUATION.test(after);
        return cx.addDelimiter(
          SingleTildeDelimiter,
          pos,
          pos + 1,
          !spaceAfter && (!punctuationAfter || spaceBefore || punctuationBefore),
          !spaceBefore && (!punctuationBefore || spaceAfter || punctuationAfter),
        );
      },
      after: "Strikethrough",
    },
  ],
};
