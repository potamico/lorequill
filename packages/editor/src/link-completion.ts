import { syntaxTree } from "@codemirror/language";
import type { EditorState } from "@codemirror/state";

/** Where completion inside a link destination applies, and what it completes. */
export type LinkCompletionContext =
  /** The page part of the destination, which starts at `from`. */
  | { readonly kind: "page"; readonly from: number }
  /** The anchor after `#`, which starts at `from`; `page` is the destination before `#`. */
  | { readonly kind: "anchor"; readonly from: number; readonly page: string };

const CODE_NODES = new Set(["InlineCode", "FencedCode", "CodeBlock", "CodeText", "HTMLBlock"]);

// An inline link destination being typed: `](` followed by the destination up to the cursor.
// Angle-bracket destinations and destinations with spaces or parentheses are not completed.
const DESTINATION = /\]\(([^()\s<>]*)$/;

/** A link destination being typed, found in the text of a line up to the cursor. */
export type LinkDestinationContext =
  /** The page part of the destination, which starts at `start` in the line. */
  | { readonly kind: "page"; readonly start: number }
  /** The anchor after `#`, which starts at `start` in the line; `page` is the part before `#`. */
  | { readonly kind: "anchor"; readonly start: number; readonly page: string };

/**
 * The destination being typed at the end of `linePrefix`, the text of a line up to the cursor.
 * It does not look at code: the caller excludes code with its own syntax tree.
 */
export function linkDestinationContext(linePrefix: string): LinkDestinationContext | undefined {
  const match = DESTINATION.exec(linePrefix);
  if (!match) {
    return undefined;
  }
  const destination = match[1] ?? "";
  const start = linePrefix.length - destination.length;
  const hash = destination.indexOf("#");
  return hash === -1
    ? { kind: "page", start }
    : { kind: "anchor", start: start + hash + 1, page: destination.slice(0, hash) };
}

/**
 * The completion context at `position` (specification §8): inside the destination of an inline
 * link, outside code. The link does not need to be closed yet, because it is being typed.
 */
export function linkCompletionContext(
  state: EditorState,
  position: number,
): LinkCompletionContext | undefined {
  const line = state.doc.lineAt(position);
  const where = linkDestinationContext(state.sliceDoc(line.from, position));
  if (!where) {
    return undefined;
  }
  for (
    let node: ReturnType<ReturnType<typeof syntaxTree>["resolveInner"]> | null = syntaxTree(
      state,
    ).resolveInner(position, -1);
    node;
    node = node.parent
  ) {
    if (CODE_NODES.has(node.name)) {
      return undefined;
    }
  }
  return where.kind === "page"
    ? { kind: "page", from: line.from + where.start }
    : { kind: "anchor", from: line.from + where.start, page: where.page };
}
