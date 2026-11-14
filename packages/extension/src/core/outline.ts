import { assignAnchors, extractHeadings, parseMarkdown } from "@lorequill/markdown";

/** A heading in the page outline (`Outline`), with the headings of lower levels below it. */
export interface OutlineNode {
  readonly text: string;
  readonly level: number;
  /** 0-based line of the heading. */
  readonly line: number;
  readonly parent: OutlineNode | undefined;
  readonly children: readonly OutlineNode[];
}

interface MutableNode extends OutlineNode {
  readonly children: OutlineNode[];
}

/**
 * Builds the outline of a page: every heading, nested below the closest preceding heading of a
 * higher level. A level that skips one (H1 followed by H3) is nested directly below the H1.
 * Front matter and code blocks never produce headings, because the Markdown parser ignores them.
 */
export function buildOutline(text: string): OutlineNode[] {
  const roots: OutlineNode[] = [];
  const open: MutableNode[] = [];
  for (const heading of extractHeadings(parseMarkdown(text))) {
    while (open.length > 0 && (open.at(-1)?.level ?? 0) >= heading.level) {
      open.pop();
    }
    const parent = open.at(-1);
    const node: MutableNode = {
      text: heading.text,
      level: heading.level,
      line: heading.start.line - 1,
      parent,
      children: [],
    };
    (parent ? parent.children : roots).push(node);
    open.push(node);
  }
  return roots;
}

/** The heading whose section contains `line`: the last heading at or above it. */
export function headingAt(roots: readonly OutlineNode[], line: number): OutlineNode | undefined {
  let found: OutlineNode | undefined;
  let candidates = roots;
  for (;;) {
    let next: OutlineNode | undefined;
    for (const node of candidates) {
      if (node.line > line) {
        break;
      }
      next = node;
    }
    if (!next) {
      return found;
    }
    found = next;
    candidates = next.children;
  }
}

/**
 * The 0-based line of the heading whose anchor is `fragment`, for links such as `page.md#setup`.
 * Both anchor algorithms of the target sites are tried (the `slugify` option belongs to the check
 * rules, not to the page), the default `ascii` first.
 */
export function findAnchorLine(text: string, fragment: string): number | undefined {
  const headings = extractHeadings(parseMarkdown(text));
  for (const slugify of ["ascii", "unicode"] as const) {
    const heading = assignAnchors(headings, slugify).find(({ id }) => id === fragment);
    if (heading) {
      return heading.start.line - 1;
    }
  }
  return undefined;
}
