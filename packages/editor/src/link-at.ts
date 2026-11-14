import { syntaxTree } from "@codemirror/language";
import type { EditorState } from "@codemirror/state";
import type { SyntaxNode } from "@lezer/common";

/**
 * The destination of the link at `position`, as written in the text (without angle brackets), for
 * Ctrl+click navigation (§8). Covers inline links and images, reference links whose definition is
 * in the page, autolinks (`<https://…>`), and bare URLs. `undefined` if there is no link there.
 */
export function linkTargetAt(state: EditorState, position: number): string | undefined {
  const tree = syntaxTree(state);
  for (const side of [1, -1] as const) {
    for (
      let node: SyntaxNode | null = tree.resolveInner(position, side);
      node;
      node = node.parent
    ) {
      if (node.name === "Link" || node.name === "Image") {
        return linkDestination(state, node);
      }
      if (node.name === "Autolink" || (node.name === "URL" && !isLinkPart(node))) {
        const url = node.name === "URL" ? node : node.getChild("URL");
        return url ? unwrap(state.sliceDoc(url.from, url.to)) : undefined;
      }
    }
  }
  return undefined;
}

function isLinkPart(node: SyntaxNode): boolean {
  const parent = node.parent?.name;
  return parent === "Link" || parent === "Image" || parent === "LinkReference";
}

function unwrap(destination: string): string {
  const trimmed = destination.trim();
  return trimmed.startsWith("<") && trimmed.endsWith(">") ? trimmed.slice(1, -1) : trimmed;
}

function linkDestination(state: EditorState, link: SyntaxNode): string | undefined {
  const url = link.getChild("URL");
  if (url) {
    return unwrap(state.sliceDoc(url.from, url.to));
  }
  // `[text][label]`, `[label][]`, or `[label]`: look up the definition in the page.
  const label = link.getChild("LinkLabel");
  const marks = link.getChildren("LinkMark");
  const opening = marks[0];
  const closing = marks[1];
  const raw =
    label && label.to - label.from > 2
      ? state.sliceDoc(label.from + 1, label.to - 1)
      : opening && closing
        ? state.sliceDoc(opening.to, closing.from)
        : undefined;
  return raw === undefined ? undefined : referenceDestination(state, normalizeLabel(raw));
}

function normalizeLabel(label: string): string {
  return label.trim().replace(/\s+/g, " ").toLowerCase();
}

function referenceDestination(state: EditorState, label: string): string | undefined {
  let found: string | undefined;
  syntaxTree(state).iterate({
    enter: (node) => {
      if (found !== undefined) {
        return false;
      }
      if (node.name !== "LinkReference") {
        return undefined;
      }
      const definitionLabel = node.node.getChild("LinkLabel");
      const url = node.node.getChild("URL");
      if (
        definitionLabel &&
        url &&
        normalizeLabel(state.sliceDoc(definitionLabel.from + 1, definitionLabel.to - 1)) === label
      ) {
        found = unwrap(state.sliceDoc(url.from, url.to));
      }
      return false;
    },
  });
  return found;
}
