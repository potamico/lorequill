import type { PageEntry } from "./scan";

export interface DirectoryNode {
  readonly kind: "directory";
  /** POSIX path relative to the content root; empty for the content root itself. */
  readonly path: string;
  readonly name: string;
  readonly children: readonly TreeNode[];
}

export interface PageNode {
  readonly kind: "page";
  readonly page: PageEntry;
}

export type TreeNode = DirectoryNode | PageNode;

/** Normalizes text for filtering: Unicode NFC, trimmed, locale-independent lower case. */
export function normalizeFilter(text: string): string {
  return text.normalize("NFC").trim().toLowerCase();
}

/**
 * Whether a page matches a filter: the filter text occurs in the title, in the file name, or in
 * one of the aliases (specification section 8). Case-insensitive. An empty filter matches all.
 */
export function matchesFilter(page: PageEntry, filter: string): boolean {
  const needle = normalizeFilter(filter);
  if (needle === "") {
    return true;
  }
  return [page.title, page.fileName, ...page.aliases].some((text) =>
    text.normalize("NFC").toLowerCase().includes(needle),
  );
}

export function filterPages(pages: readonly PageEntry[], filter: string): PageEntry[] {
  return pages.filter((page) => matchesFilter(page, filter));
}

interface MutableDirectory {
  path: string;
  name: string;
  directories: Map<string, MutableDirectory>;
  pages: PageEntry[];
}

function newDirectory(path: string, name: string): MutableDirectory {
  return { path, name, directories: new Map(), pages: [] };
}

/**
 * Builds the tree of directories and pages. A directory appears only when it contains at least
 * one of the given pages, directly or in a subdirectory. Directories come first, then pages;
 * both are sorted with the collator and, for equal labels, by path, so the order is stable.
 */
export function buildPageTree(pages: readonly PageEntry[], collator: Intl.Collator): DirectoryNode {
  const root = newDirectory("", "");
  for (const page of pages) {
    const segments = page.path.split("/");
    segments.pop();
    let directory = root;
    let currentPath = "";
    for (const segment of segments) {
      currentPath = currentPath === "" ? segment : `${currentPath}/${segment}`;
      let child = directory.directories.get(segment);
      if (!child) {
        child = newDirectory(currentPath, segment);
        directory.directories.set(segment, child);
      }
      directory = child;
    }
    directory.pages.push(page);
  }
  return freeze(root, collator);
}

function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function freeze(directory: MutableDirectory, collator: Intl.Collator): DirectoryNode {
  const directories = [...directory.directories.values()]
    .sort((a, b) => collator.compare(a.name, b.name) || compareStrings(a.path, b.path))
    .map((child) => freeze(child, collator));
  const pages = [...directory.pages]
    .sort((a, b) => collator.compare(a.title, b.title) || compareStrings(a.path, b.path))
    .map((page): PageNode => ({ kind: "page", page }));
  return {
    kind: "directory",
    path: directory.path,
    name: directory.name,
    children: [...directories, ...pages],
  };
}

/** Collator for labels: natural number order, accents and case compared loosely at first. */
export function createLabelCollator(locale: string): Intl.Collator {
  return new Intl.Collator(locale, { numeric: true, sensitivity: "base" });
}
