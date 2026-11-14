import type { Nodes, Parent, Root, RootContent } from "mdast";
import type { Point } from "unist";
import { fromMarkdown } from "mdast-util-from-markdown";
import { gfmFromMarkdown } from "mdast-util-gfm";
import { gfm } from "micromark-extension-gfm";
import { findContainers, type ContainerBlock, type ContainerKind } from "./containers";
import { findFrontMatter } from "./front-matter";

/** A Material for MkDocs container block (admonition, collapsible block, or content tab). */
export interface Container extends Parent {
  readonly type: "container";
  readonly kind: ContainerKind;
  readonly marker: string;
  readonly containerType?: string;
  readonly title?: string;
  children: RootContent[];
}

declare module "mdast" {
  interface RootContentMap {
    container: Container;
  }
  interface BlockContentMap {
    container: Container;
  }
}

/** A parsed Markdown text. Every node has a position with line, column, and offset. */
export interface MarkdownDocument {
  /** The original text. Positions refer to it. */
  readonly text: string;
  readonly root: Root;
}

const PARSE_OPTIONS = { extensions: [gfm()], mdastExtensions: [gfmFromMarkdown()] };

/**
 * Parses Markdown into an `mdast` syntax tree with exact source positions (specification §10).
 *
 * - CommonMark and GFM (tables, task lists, strikethrough, autolink literals, footnotes).
 * - YAML front matter is not part of the body: it is parsed as blank lines, so positions stay
 *   exact.
 * - Material for MkDocs containers become `container` nodes whose indented body is parsed as
 *   nested Markdown instead of an indented code block.
 *
 * Nothing is executed or fetched. Raw HTML stays `html` nodes and is never interpreted.
 */
export function parseMarkdown(text: string): MarkdownDocument {
  return { text, root: parseWithContainers(blankFrontMatter(text)) };
}

/** Replaces the front matter (and a byte order mark) with spaces, keeping every offset. */
function blankFrontMatter(text: string): string {
  const block = findFrontMatter(text);
  let result = text;
  if (block) {
    result =
      text.slice(0, block.start) +
      blank(text.slice(block.start, block.end)) +
      text.slice(block.end);
  }
  return result.startsWith("﻿") ? ` ${result.slice(1)}` : result;
}

function blank(text: string): string {
  return text.replace(/[^\r\n]/g, " ");
}

function parseWithContainers(text: string): Root {
  const containers = findContainers(text);
  // One pass over the text: rebuilding it per container would be quadratic on long pages.
  const pieces: string[] = [];
  let copied = 0;
  for (const container of containers) {
    pieces.push(
      text.slice(copied, container.start),
      blank(text.slice(container.start, container.end)),
    );
    copied = container.end;
  }
  pieces.push(text.slice(copied));
  const main = pieces.join("");
  const root = fromMarkdown(main, PARSE_OPTIONS);
  if (containers.length === 0) {
    return root;
  }
  const lineStarts = computeLineStarts(text);
  for (const container of containers) {
    insertNode(root, containerNode(container, lineStarts), container.indent);
  }
  return root;
}

function containerNode(block: ContainerBlock, lineStarts: readonly number[]): Container {
  const subText = block.body.map((line) => line.content).join("\n");
  const subRoot = parseWithContainers(subText);
  const subLineStarts = computeLineStarts(subText);
  const mapOffset = (offset: number): number => {
    const line = lineIndexAt(subLineStarts, offset);
    const bodyLine = block.body[line];
    const subStart = subLineStarts[line] ?? 0;
    return bodyLine ? bodyLine.lineStart + bodyLine.removed + (offset - subStart) : block.end;
  };
  for (const child of subRoot.children) {
    mapPositions(child, (point) => pointAt(lineStarts, mapOffset(point.offset ?? 0)));
  }
  return {
    type: "container",
    kind: block.kind,
    marker: block.marker,
    ...(block.type === undefined ? {} : { containerType: block.type }),
    ...(block.title === undefined ? {} : { title: block.title }),
    children: subRoot.children,
    position: { start: pointAt(lineStarts, block.start), end: pointAt(lineStarts, block.end) },
  };
}

function mapPositions(node: Nodes, map: (point: Point) => Point): void {
  if (node.position) {
    node.position = { start: map(node.position.start), end: map(node.position.end) };
  }
  if ("children" in node) {
    for (const child of node.children) {
      mapPositions(child, map);
    }
  }
}

/**
 * Inserts a container into the deepest parent that encloses it, in document order. A container
 * indented below a list continues the last item of that list, because blanking the container may
 * have cut the item short.
 */
function insertNode(parent: Parent, node: Container, indent: number): void {
  const start = node.position?.start.offset ?? 0;
  const end = node.position?.end.offset ?? start;
  const children: RootContent[] = parent.children;
  // Children are in document order: find the first that starts after the container by bisection.
  let index = 0;
  let high = children.length;
  while (index < high) {
    const middle = (index + high) >> 1;
    if ((children[middle]?.position?.start.offset ?? 0) > start) {
      high = middle;
    } else {
      index = middle + 1;
    }
  }
  const enclosing = children[index - 1];
  if (
    enclosing &&
    "children" in enclosing &&
    enclosing.type !== "container" &&
    (enclosing.position?.end.offset ?? 0) >= end
  ) {
    insertNode(enclosing, node, indent);
    return;
  }
  if (enclosing?.type === "list" && indent > 0) {
    const item = enclosing.children.at(-1);
    if (item) {
      insertNode(item, node, indent);
      return;
    }
  }
  children.splice(index, 0, node);
}

function computeLineStarts(text: string): number[] {
  const starts = [0];
  let index = text.indexOf("\n");
  while (index !== -1) {
    starts.push(index + 1);
    index = text.indexOf("\n", index + 1);
  }
  return starts;
}

function lineIndexAt(lineStarts: readonly number[], offset: number): number {
  let low = 0;
  let high = lineStarts.length - 1;
  while (low < high) {
    const middle = (low + high + 1) >> 1;
    if ((lineStarts[middle] ?? 0) <= offset) {
      low = middle;
    } else {
      high = middle - 1;
    }
  }
  return low;
}

function pointAt(lineStarts: readonly number[], offset: number): Point {
  const line = lineIndexAt(lineStarts, offset);
  return { line: line + 1, column: offset - (lineStarts[line] ?? 0) + 1, offset };
}
