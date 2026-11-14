import type { Nodes } from "mdast";
import type { Point } from "unist";
import type { MarkdownDocument } from "./parse";

/** Where a link destination comes from. */
export type LinkKind =
  /** `[text](destination "title")` */
  | "inline"
  /** `<https://example.com>`, `<mail@example.com>`, or a GFM autolink literal. */
  | "autolink"
  /** A reference definition `[label]: destination`. */
  | "definition";

export interface MarkdownLink {
  readonly kind: LinkKind;
  /**
   * The destination after Markdown unescaping and character references, but before
   * percent-decoding: `<a b.md>` gives `a b.md`, `a%20b.md` stays `a%20b.md`.
   */
  readonly destination: string;
  readonly title?: string;
  /** The normalized label of a definition. */
  readonly label?: string;
  readonly start: Point;
  readonly end: Point;
}

/**
 * Lists the link destinations of a document in document order (specification §10).
 *
 * Inline links and autolinks are reported where they occur. Reference links (`[text][label]`,
 * `[label][]`, `[label]`) are reported once, at their definition, so a broken definition yields
 * one finding however often it is used; a definition is reported even when no link uses it.
 * Images are not page links and are skipped. Links in code are not links, so they never appear.
 * Raw HTML is not interpreted.
 */
export function extractLinks(document: MarkdownDocument): MarkdownLink[] {
  const links: MarkdownLink[] = [];
  visit(document.root, (node) => {
    if (!node.position) {
      return;
    }
    const { start, end } = node.position;
    if (node.type === "link") {
      const opener = document.text.charAt(start.offset ?? 0);
      links.push({
        kind: opener === "[" ? "inline" : "autolink",
        destination: node.url,
        ...(node.title ? { title: node.title } : {}),
        start,
        end,
      });
    } else if (node.type === "definition") {
      links.push({
        kind: "definition",
        destination: node.url,
        ...(node.title ? { title: node.title } : {}),
        label: node.identifier,
        start,
        end,
      });
    }
  });
  return links;
}

/** Calls `callback` for every node in document order. */
export function visit(node: Nodes, callback: (node: Nodes) => void): void {
  callback(node);
  if ("children" in node) {
    for (const child of node.children) {
      visit(child, callback);
    }
  }
}
