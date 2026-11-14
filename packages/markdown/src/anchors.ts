import type { Heading, Nodes } from "mdast";
import type { Point } from "unist";
import { visit } from "./links";
import type { MarkdownDocument } from "./parse";

/**
 * The heading anchor algorithm of the target site (specification §10, decision D8).
 *
 * - `ascii`: the default `slugify` of Python-Markdown's `toc` extension, which MkDocs uses unless
 *   configured otherwise. Accents are removed and other non-ASCII characters dropped.
 * - `unicode`: `pymdownx.slugs.slugify(case="lower")`, recommended by Material for MkDocs. Letters
 *   of every script are kept; each space becomes a hyphen.
 *
 * Both are verified against fixtures generated with the real libraries
 * (`fixtures/anchors/python-markdown.json`).
 */
export type AnchorSlugify = "ascii" | "unicode";

export interface MarkdownHeading {
  readonly level: number;
  /** The text the anchor is computed from: inline formatting removed, attribute list removed. */
  readonly text: string;
  /** Identifier from a trailing attribute list such as `{#custom}` or `{: #custom .class }`. */
  readonly explicitId?: string;
  readonly start: Point;
  readonly end: Point;
}

export interface AnchoredHeading extends MarkdownHeading {
  /** The anchor the site generates for this heading. */
  readonly id: string;
}

// A trailing attribute list as recognized by Python-Markdown's attr_list extension for headings.
const ATTRIBUTE_LIST = /[ \t]*\{:?[ ]*([^}\n ][^}\n]*?)[ ]*\}[ \t]*$/;
const ID_COUNT = /^(.*)_([0-9]+)$/;
const HTML_ID = /\b(?:id|name)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;

/** Computes the anchor slug of a heading text, before duplicates are made unique. */
export function slugifyAnchor(text: string, slugify: AnchorSlugify): string {
  const value = text.replace(/\s+/g, " ").trim();
  if (slugify === "ascii") {
    const ascii = value
      .normalize("NFKD")
      .replace(/[\u0080-\uFFFF]/g, "")
      .replace(/[^\w\s-]/g, "")
      .trim()
      .toLowerCase();
    return ascii.replace(/[-\s]+/g, "-");
  }
  return value
    .normalize("NFC")
    .replace(/[^\p{L}\p{N}_\- ]/gu, "")
    .trim()
    .toLowerCase()
    .replace(/ /g, "-");
}

/** Lists the headings of a document in document order, including headings inside containers. */
export function extractHeadings(document: MarkdownDocument): MarkdownHeading[] {
  const headings: MarkdownHeading[] = [];
  visit(document.root, (node) => {
    if (node.type === "heading" && node.position) {
      headings.push(describeHeading(node, node.position.start, node.position.end));
    }
  });
  return headings;
}

function describeHeading(node: Heading, start: Point, end: Point): MarkdownHeading {
  let text = headingText(node);
  let explicitId: string | undefined;
  const last = node.children.at(-1);
  if (last?.type === "text") {
    const attributes = ATTRIBUTE_LIST.exec(text);
    if (attributes?.[1]) {
      text = text.slice(0, attributes.index);
      explicitId = attributes[1]
        .split(/\s+/)
        .find((token) => token.startsWith("#") && token.length > 1)
        ?.slice(1);
    }
  }
  return {
    level: node.depth,
    text: text.replace(/\s+/g, " ").trim(),
    ...(explicitId === undefined ? {} : { explicitId }),
    start,
    end,
  };
}

/** Text of a heading as Python-Markdown's toc sees it: images and HTML tags contribute nothing. */
function headingText(node: Nodes): string {
  switch (node.type) {
    case "text":
    case "inlineCode":
      return node.value;
    case "image":
    case "imageReference":
    case "html":
    case "footnoteReference":
      return "";
    case "break":
      return " ";
    default:
      return "children" in node ? node.children.map(headingText).join("") : "";
  }
}

/**
 * Assigns anchors like Python-Markdown's toc extension: explicit identifiers are kept and reserved
 * first; every other heading gets its slug, made unique with `_1`, `_2`, ... suffixes. An empty
 * slug becomes `_1`.
 */
export function assignAnchors(
  headings: readonly MarkdownHeading[],
  slugify: AnchorSlugify,
): AnchoredHeading[] {
  const used = new Set<string>();
  for (const heading of headings) {
    if (heading.explicitId !== undefined) {
      used.add(heading.explicitId);
    }
  }
  return headings.map((heading) => ({
    ...heading,
    id: heading.explicitId ?? unique(slugifyAnchor(heading.text, slugify), used),
  }));
}

function unique(id: string, used: Set<string>): string {
  let candidate = id;
  while (used.has(candidate) || candidate === "") {
    const match = ID_COUNT.exec(candidate);
    candidate =
      match?.[1] !== undefined && match[2] !== undefined
        ? `${match[1]}_${String(Number(match[2]) + 1)}`
        : `${candidate}_1`;
  }
  used.add(candidate);
  return candidate;
}

/**
 * All fragment targets of a document: heading anchors plus `id` and `name` attributes written in
 * raw HTML (for example `<a id="legacy"></a>`), which the site keeps as they are.
 */
export function collectAnchors(document: MarkdownDocument, slugify: AnchorSlugify): Set<string> {
  const anchors = new Set(assignAnchors(extractHeadings(document), slugify).map(({ id }) => id));
  visit(document.root, (node) => {
    if (node.type === "html") {
      for (const match of node.value.matchAll(HTML_ID)) {
        const id = match[1] ?? match[2];
        if (id) {
          anchors.add(id);
        }
      }
    }
  });
  return anchors;
}
