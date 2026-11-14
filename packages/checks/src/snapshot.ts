import {
  createFileSystemTargetProvider,
  type LinkTargetProvider,
  type TargetKind,
} from "@lorequill/markdown";
import { listContentFiles, MAX_CONTENT_ENTRIES } from "@lorequill/profile";

/** The files below the content root, as listed by a snapshot. */
export interface FileListing {
  /** Regular files, POSIX paths relative to the content root. Symbolic links are not listed. */
  readonly files: readonly string[];
  /** The listing stopped at its entry limit and is incomplete. */
  readonly truncated: boolean;
}

/**
 * An immutable, read-only view of the files below one content root (specification §11). The
 * engine never writes and never executes anything from it.
 *
 * Implementations: the filesystem ({@link createFileSystemSnapshot}), the filesystem with unsaved
 * editor buffers on top ({@link withOverrides}), and later the staged Git tree.
 */
export interface ContentSnapshot extends LinkTargetProvider {
  listFiles(signal?: AbortSignal): Promise<FileListing>;
}

/** Same limit as the Pages tree, which lists the same files. */
export const MAX_LISTED_ENTRIES = MAX_CONTENT_ENTRIES;

/**
 * A snapshot of the filesystem below `contentRoot` (an absolute path). Listing is the shared
 * {@link listContentFiles} walk of the Pages tree; target checks verify real paths and exact name
 * case through the shared filesystem target provider.
 */
export function createFileSystemSnapshot(
  contentRoot: string,
  options: { readonly maxEntries?: number } = {},
): ContentSnapshot {
  const targets = createFileSystemTargetProvider(contentRoot);
  const maxEntries = options.maxEntries ?? MAX_LISTED_ENTRIES;
  return {
    describe: (path) => targets.describe(path),
    readText: (path) => targets.readText(path),
    listFiles: (signal) => listContentFiles(contentRoot, { maxEntries, signal }),
  };
}

/**
 * A snapshot with in-memory texts on top, for unsaved editor buffers. An overridden path is a
 * regular file with the given text, whatever the underlying snapshot says.
 */
export function withOverrides(
  base: ContentSnapshot,
  overrides: ReadonlyMap<string, string>,
): ContentSnapshot {
  return {
    async describe(path): Promise<TargetKind> {
      return overrides.has(path) ? "file" : base.describe(path);
    },
    async readText(path) {
      return overrides.get(path) ?? base.readText(path);
    },
    async listFiles(signal) {
      const listing = await base.listFiles(signal);
      const files = new Set(listing.files);
      for (const path of overrides.keys()) {
        files.add(path);
      }
      return { files: [...files].sort(), truncated: listing.truncated };
    },
  };
}
