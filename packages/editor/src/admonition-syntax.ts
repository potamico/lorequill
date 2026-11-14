import { tags } from "@lezer/highlight";
import type { Line, MarkdownConfig } from "@lezer/markdown";
import { ADMONITION_MARKER } from "@lorequill/markdown/containers";

/**
 * Material for MkDocs admonitions (`!!! note "Title"`) and collapsible blocks (`??? tip`,
 * `???+ tip`) for the CodeMirror Markdown parser. Like a blockquote, the block is a composite: its
 * body is the following lines that are blank or indented by four more columns than the marker,
 * and the body is parsed as ordinary Markdown, so lists, emphasis, and code inside are recognized.
 * The marker syntax is the one `packages/markdown` uses for checks and the preview.
 *
 * One difference to Python-Markdown is accepted because this parser only drives the editor's
 * display: an unindented line directly after a body paragraph continues that paragraph (CommonMark
 * lazy continuation, as for blockquotes) instead of ending the block.
 */

const BODY_INDENT = 4;

function isMarker(line: Line): boolean {
  return line.indent - line.baseIndent < 4 && ADMONITION_MARKER.test(line.text.slice(line.pos));
}

export const admonitionSyntax: MarkdownConfig = {
  defineNodes: [
    {
      name: "Admonition",
      block: true,
      composite(_cx, line, value) {
        if (line.next < 0) {
          return true;
        }
        if (line.indent < line.baseIndent + value) {
          return false;
        }
        line.moveBaseColumn(line.baseIndent + value);
        return true;
      },
    },
    { name: "AdmonitionMark", style: tags.processingInstruction },
  ],
  parseBlock: [
    {
      name: "Admonition",
      parse(cx, line) {
        if (!isMarker(line)) {
          return false;
        }
        cx.startComposite("Admonition", line.pos, line.indent - line.baseIndent + BODY_INDENT);
        cx.addElement(
          cx.elt("AdmonitionMark", cx.lineStart + line.pos, cx.lineStart + line.text.length),
        );
        line.moveBase(line.text.length);
        return null;
      },
      // A marker line ends a paragraph, like a heading does.
      endLeaf: (_cx, line) => isMarker(line),
    },
  ],
};

/** The admonition families of Material for MkDocs, with the aliases it accepts. */
const FAMILIES: Readonly<Record<string, string>> = {
  note: "note",
  seealso: "note",
  abstract: "abstract",
  summary: "abstract",
  tldr: "abstract",
  info: "info",
  todo: "info",
  tip: "tip",
  hint: "tip",
  important: "tip",
  success: "success",
  check: "success",
  done: "success",
  question: "question",
  help: "question",
  faq: "question",
  warning: "warning",
  caution: "warning",
  attention: "warning",
  failure: "failure",
  fail: "failure",
  missing: "failure",
  danger: "danger",
  error: "danger",
  bug: "bug",
  example: "example",
  quote: "quote",
  cite: "quote",
};

/** Codicons for the admonition families. */
export const ADMONITION_ICONS: Readonly<Record<string, string>> = {
  note: "edit",
  abstract: "list-unordered",
  info: "info",
  tip: "lightbulb",
  success: "check",
  question: "question",
  warning: "warning",
  failure: "close",
  danger: "zap",
  bug: "bug",
  example: "beaker",
  quote: "quote",
};

/** The admonition family of a type such as `seealso` (case-insensitive); `note` if unknown. */
export function admonitionFamily(type: string): string {
  return FAMILIES[type.toLowerCase()] ?? "note";
}

export interface AdmonitionHeader {
  readonly marker: string;
  /** The admonition family that decides color and icon; `note` for unknown types. */
  readonly family: string;
  /** The quoted title, or the type with an initial capital as Material shows it. */
  readonly title: string;
  readonly collapsible: boolean;
}

/** Reads a marker line such as `??? tip "Title"`; `undefined` if it is not one. */
export function readAdmonitionHeader(text: string): AdmonitionHeader | undefined {
  const match = ADMONITION_MARKER.exec(text.trim());
  if (!match?.[1] || !match[2]) {
    return undefined;
  }
  const type = match[2].split(/[ \t]+/)[0] ?? "note";
  const title = match[3] ?? type.charAt(0).toUpperCase() + type.slice(1);
  return {
    marker: match[1],
    family: admonitionFamily(type),
    title,
    collapsible: match[1].startsWith("???"),
  };
}
