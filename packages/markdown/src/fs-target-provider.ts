import { lstat, readFile, readdir, realpath } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import type { LinkTargetProvider, TargetKind } from "./link-target";

/**
 * A {@link LinkTargetProvider} over the filesystem below `contentRoot` (an absolute path).
 *
 * - Containment is verified with the real path, so a symbolic link that resolves outside the
 *   content root is reported as `outside`, even when its lexical path is inside.
 * - Names must match exactly, including case, so a link that only works on a case-insensitive
 *   filesystem is reported as `missing`, as it would be on a Linux CI machine.
 * - Directory listings and real paths are cached for the lifetime of the provider.
 */
export function createFileSystemTargetProvider(contentRoot: string): LinkTargetProvider {
  const listings = new Map<string, Promise<ReadonlySet<string> | undefined>>();
  let rootReal: Promise<string | undefined> | undefined;

  const list = (directory: string): Promise<ReadonlySet<string> | undefined> => {
    let listing = listings.get(directory);
    if (!listing) {
      listing = readdir(directory).then(
        (names) => new Set(names),
        () => undefined,
      );
      listings.set(directory, listing);
    }
    return listing;
  };

  const existsExactly = async (path: string): Promise<boolean> => {
    let directory = contentRoot;
    for (const segment of path.split("/")) {
      if (!(await list(directory))?.has(segment)) {
        return false;
      }
      directory = join(directory, segment);
    }
    return true;
  };

  const describe = async (path: string): Promise<TargetKind> => {
    if (path !== "." && !(await existsExactly(path))) {
      return "missing";
    }
    const absolute = path === "." ? contentRoot : join(contentRoot, ...path.split("/"));
    rootReal ??= realpath(contentRoot).catch(() => undefined);
    const [root, target] = await Promise.all([rootReal, realpath(absolute).catch(() => undefined)]);
    if (root === undefined || target === undefined) {
      return "missing";
    }
    const fromRoot = relative(root, target);
    if (fromRoot.startsWith(`..${sep}`) || fromRoot === ".." || /^[A-Za-z]:/.test(fromRoot)) {
      return "outside";
    }
    try {
      const stats = await lstat(target);
      if (stats.isFile()) {
        return "file";
      }
      return stats.isDirectory() ? "directory" : "unsupported";
    } catch {
      return "missing";
    }
  };

  return {
    describe,
    async readText(path) {
      if ((await describe(path)) !== "file") {
        return undefined;
      }
      try {
        return await readFile(join(contentRoot, ...path.split("/")), "utf8");
      } catch {
        return undefined;
      }
    },
  };
}
