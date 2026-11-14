import { open, realpath, stat } from "node:fs/promises";
import * as path from "node:path";
import { readPageMetadata, type PageMetadata } from "@lorequill/markdown";
import {
  listContentFiles,
  MAX_CONTENT_ENTRIES,
  type ContentFiles,
  type ContentScope,
} from "@lorequill/profile";

/** A page below the content root, with the metadata shown in the Pages tree. */
export interface PageEntry extends PageMetadata {
  /** POSIX path relative to the content root, for example `guides/setup.md`. */
  readonly path: string;
  /** Last path segment, for example `setup.md`. */
  readonly fileName: string;
}

/** Stops the scan after this many directory entries; the result is then marked as truncated. */
export const MAX_SCANNED_ENTRIES = MAX_CONTENT_ENTRIES;

/**
 * Only the beginning of a page is read to find front matter and the first heading. A larger
 * page still gets a title from its first 256 KiB.
 */
export const MAX_PAGE_PREFIX_BYTES = 256 * 1024;

/** How many pages are read at the same time. */
const READ_CONCURRENCY = 16;

interface CachedPage {
  readonly size: number;
  readonly mtimeMs: number;
  readonly entry: PageEntry;
}

/**
 * Remembers the metadata of pages that did not change (same size and modification time), so a
 * refresh after a file event only reads changed files. Owned by the caller, one per folder.
 */
export type PageCache = Map<string, CachedPage>;

export interface ScanOptions {
  /** Absolute path of the workspace folder (repository root). */
  readonly workspaceRoot: string;
  /** `content.root` of the profile: a relative POSIX directory, or `.`. */
  readonly contentRoot: string;
  readonly scope: ContentScope;
  readonly cache?: PageCache;
  readonly signal?: AbortSignal;
  readonly maxEntries?: number;
}

export type ScanResult =
  | {
      readonly ok: true;
      /** Sorted by path. */
      readonly pages: readonly PageEntry[];
      /** True when the scan stopped at the entry limit, so the page list is incomplete. */
      readonly truncated: boolean;
    }
  | { readonly ok: false; readonly reason: "missing" | "outside" | "unreadable" | "cancelled" };

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

function isInsideOrSame(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return (
    relative === "" ||
    (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
  );
}

/**
 * Resolves the content root to a real directory that lies inside the workspace folder, so a
 * symbolic link cannot make the extension read files elsewhere (specification section 15).
 */
export async function resolveContentRoot(
  workspaceRoot: string,
  contentRoot: string,
): Promise<
  | { readonly ok: true; readonly directory: string }
  | { readonly ok: false; readonly reason: "missing" | "outside" | "unreadable" }
> {
  try {
    const realWorkspace = await realpath(workspaceRoot);
    const candidate =
      contentRoot === "." ? realWorkspace : path.join(realWorkspace, ...contentRoot.split("/"));
    const realContent = await realpath(candidate);
    if (!isInsideOrSame(realWorkspace, realContent)) {
      return { ok: false, reason: "outside" };
    }
    if (!(await stat(realContent)).isDirectory()) {
      return { ok: false, reason: "missing" };
    }
    return { ok: true, directory: realContent };
  } catch (error) {
    return {
      ok: false,
      reason:
        isNodeError(error) && (error.code === "ENOENT" || error.code === "ENOTDIR")
          ? "missing"
          : "unreadable",
    };
  }
}

function isMarkdownFileName(name: string): boolean {
  return name.toLowerCase().endsWith(".md");
}

interface Candidate {
  readonly relativePath: string;
  readonly absolutePath: string;
}

async function readPrefix(file: string): Promise<string> {
  const handle = await open(file, "r");
  try {
    const buffer = Buffer.alloc(MAX_PAGE_PREFIX_BYTES);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    // Invalid UTF-8 becomes replacement characters; titles are best effort.
    return new TextDecoder("utf-8").decode(buffer.subarray(0, bytesRead));
  } finally {
    await handle.close();
  }
}

function fallbackEntry(relativePath: string): PageEntry {
  const fileName = relativePath.slice(relativePath.lastIndexOf("/") + 1);
  return {
    path: relativePath,
    fileName,
    title: fileName,
    titleSource: "filename",
    aliases: [],
    frontMatter: "none",
  };
}

async function loadEntry(
  candidate: Candidate,
  cache: PageCache | undefined,
): Promise<PageEntry | undefined> {
  try {
    const { size, mtimeMs } = await stat(candidate.absolutePath);
    const cached = cache?.get(candidate.relativePath);
    if (cached?.size === size && cached.mtimeMs === mtimeMs) {
      return cached.entry;
    }
    const text = await readPrefix(candidate.absolutePath);
    const fileName = candidate.relativePath.slice(candidate.relativePath.lastIndexOf("/") + 1);
    const entry: PageEntry = {
      path: candidate.relativePath,
      fileName,
      ...readPageMetadata(text, fileName),
    };
    cache?.set(candidate.relativePath, { size, mtimeMs, entry });
    return entry;
  } catch (error) {
    // A file that vanished since the directory was read is not a page any more. A file that
    // cannot be read is still listed, by its file name.
    return isNodeError(error) && error.code === "ENOENT"
      ? undefined
      : fallbackEntry(candidate.relativePath);
  }
}

async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  work: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await work(items[index] as T);
    }
  });
  await Promise.all(workers);
  return results;
}

/**
 * Lists the pages below the content root: regular `.md` files that match the include and
 * exclude patterns of the profile. Symbolic links are not followed and `.git` and
 * `node_modules` directories are skipped. The result is sorted by path and does not depend on
 * the order in which the file system returns entries.
 */
export async function scanPages(options: ScanOptions): Promise<ScanResult> {
  const root = await resolveContentRoot(options.workspaceRoot, options.contentRoot);
  if (!root.ok) {
    return root;
  }

  let listing: ContentFiles;
  try {
    listing = await listContentFiles(root.directory, {
      maxEntries: options.maxEntries ?? MAX_SCANNED_ENTRIES,
      signal: options.signal,
      accept: (relativePath) =>
        isMarkdownFileName(relativePath) && options.scope.isIncluded(relativePath),
    });
  } catch (error) {
    if (options.signal?.aborted) {
      return { ok: false, reason: "cancelled" };
    }
    throw error;
  }
  const { truncated } = listing;
  const candidates: Candidate[] = listing.files.map((relativePath) => ({
    relativePath,
    absolutePath: path.join(root.directory, ...relativePath.split("/")),
  }));

  const loaded = await mapWithConcurrency(candidates, READ_CONCURRENCY, (candidate) =>
    loadEntry(candidate, options.cache),
  );
  if (options.signal?.aborted) {
    return { ok: false, reason: "cancelled" };
  }

  const pages = loaded
    .filter((entry): entry is PageEntry => entry !== undefined)
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));

  // Forget cached pages that no longer exist.
  if (options.cache) {
    const current = new Set(pages.map((page) => page.path));
    for (const key of options.cache.keys()) {
      if (!current.has(key)) {
        options.cache.delete(key);
      }
    }
  }
  return { ok: true, pages, truncated };
}
