import type { Dirent } from "node:fs";
import { readdir } from "node:fs/promises";
import { join } from "node:path";

/** Directory names that are never searched for content. */
export const SKIPPED_DIRECTORIES: ReadonlySet<string> = new Set([".git", "node_modules"]);

/** Listing stops after this many directory entries; the result is then marked as truncated. */
export const MAX_CONTENT_ENTRIES = 50_000;

/** The regular files below a content root. */
export interface ContentFiles {
  /** POSIX paths relative to the content root, sorted. */
  readonly files: readonly string[];
  /** The listing stopped at its entry limit and is incomplete. */
  readonly truncated: boolean;
}

export interface ContentFilesOptions {
  readonly maxEntries?: number;
  /** Aborting rejects with the signal's reason. */
  readonly signal?: AbortSignal | undefined;
  /** Keeps only the files it accepts; their entries still count toward the limit. */
  readonly accept?: (path: string) => boolean;
}

/**
 * Lists the regular files below `root` (an absolute path), the one walk that the Pages tree and
 * the check engine share, so both see the same files (specification §6, §11). It goes breadth
 * first, so a truncated listing keeps the pages nearest to the root; skips `.git` and
 * `node_modules`; and never follows symbolic links. Sockets and other special files are ignored.
 * An unreadable or vanished subdirectory is skipped; the rest is still listed.
 */
export async function listContentFiles(
  root: string,
  options: ContentFilesOptions = {},
): Promise<ContentFiles> {
  const maxEntries = options.maxEntries ?? MAX_CONTENT_ENTRIES;
  const files: string[] = [];
  const queue: string[] = [""];
  let visited = 0;
  let truncated = false;
  // The array iterator also visits the directories pushed during the walk.
  walk: for (const directory of queue) {
    options.signal?.throwIfAborted();
    let entries: Dirent[];
    try {
      entries = await readdir(join(root, ...directory.split("/")), { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      visited++;
      if (visited > maxEntries) {
        truncated = true;
        break walk;
      }
      const path = directory === "" ? entry.name : `${directory}/${entry.name}`;
      if (entry.isDirectory()) {
        if (!SKIPPED_DIRECTORIES.has(entry.name)) {
          queue.push(path);
        }
      } else if (entry.isFile() && (options.accept?.(path) ?? true)) {
        files.push(path);
      }
    }
  }
  options.signal?.throwIfAborted();
  return { files: files.sort(), truncated };
}
