import {
  assignAnchors,
  bodyStart,
  extractHeadings,
  parseMarkdown,
  relativeLinkPath,
  visit,
  type AnchorSlugify,
} from "@lorequill/markdown";
import type { Profile } from "@lorequill/profile";
import type { PageEntry } from "../pages/scan";

/** A page Insert Link and link completion can point to. */
export interface PageLinkItem {
  readonly page: PageEntry;
  /** Relative destination from the source page, as Insert Link writes it. */
  readonly destination: string;
}

/** A heading anchor of a page. */
export interface AnchorItem {
  readonly id: string;
  readonly text: string;
  readonly level: number;
}

/**
 * The anchor algorithm of a folder: the `slugify` of its `relative-links` check, or the default
 * of that rule (D11), so completion offers exactly the anchors the check accepts.
 */
export function slugifyOf(profile: Profile): AnchorSlugify {
  const rule = profile.checks?.rules?.find((candidate) => candidate.rule === "relative-links");
  return rule?.rule === "relative-links" ? (rule.slugify ?? "ascii") : "ascii";
}

/**
 * Editable pages (included, not excluded) as link targets of `sourcePath`, sorted by title. The
 * source page itself is left out: links within a page use a fragment only.
 */
export function pageLinkItems(pages: readonly PageEntry[], sourcePath: string): PageLinkItem[] {
  return pages
    .filter((page) => page.path !== sourcePath)
    .map((page) => ({ page, destination: relativeLinkPath(sourcePath, page.path) }))
    .sort(
      (a, b) => a.page.title.localeCompare(b.page.title) || a.page.path.localeCompare(b.page.path),
    );
}

/** The headings of a page text with the anchors the site generates for them. */
export function anchorItems(text: string, slugify: AnchorSlugify): AnchorItem[] {
  return assignAnchors(extractHeadings(parseMarkdown(text)), slugify).map((heading) => ({
    id: heading.id,
    text: heading.text,
    level: heading.level,
  }));
}

/** The destination for a page and an optional anchor, encoded exactly like Insert Link. */
export function linkDestination(sourcePath: string, targetPath: string, anchor?: string): string {
  return targetPath === sourcePath && anchor !== undefined
    ? `#${relativeLinkPath(sourcePath, targetPath, anchor).split("#")[1] ?? anchor}`
    : relativeLinkPath(sourcePath, targetPath, anchor);
}

/** Escapes link text so it cannot end the link or start other syntax. */
export function escapeLinkText(text: string): string {
  return text
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[\\[\]]/g, (character) => `\\${character}`);
}

/**
 * Whether `offset` in a page text lies where a link cannot be typed: in the front matter, in code
 * (fenced, indented, or inline), or in raw HTML. Uses the same parser as the checks, so completion
 * and checks agree on what is a link.
 */
export function noLinkAt(text: string, offset: number): boolean {
  if (offset < bodyStart(text)) {
    return true;
  }
  let inside = false;
  visit(parseMarkdown(text).root, (node) => {
    const start = node.position?.start.offset;
    const end = node.position?.end.offset;
    if (inside || start === undefined || end === undefined) {
      return;
    }
    if (node.type === "inlineCode") {
      inside = start < offset && offset < end;
    } else if (node.type === "code" || node.type === "html") {
      // A block runs to the end of its last line, which may be the end of an unclosed fence.
      inside = start < offset && offset <= end;
    }
  });
  return inside;
}
