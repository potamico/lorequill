import * as nodePath from "node:path";

/** The parts of `node:path` that {@link relativeInside} uses; `path.win32` or `path.posix` in tests. */
export type PathApi = Pick<typeof nodePath, "relative" | "isAbsolute" | "sep">;

/**
 * The path of `target` relative to `root`, with `/` separators, or `undefined` when it lies
 * outside; `""` for the root itself. Comparison follows the platform's path rules, so on Windows a
 * drive letter or a name that differs only in case is still inside.
 */
export function relativeInside(
  root: string,
  target: string,
  paths: PathApi = nodePath,
): string | undefined {
  const relative = paths.relative(root, target);
  if (relative === ".." || relative.startsWith(`..${paths.sep}`) || paths.isAbsolute(relative)) {
    return undefined;
  }
  return paths.sep === "/" ? relative : relative.split(paths.sep).join("/");
}
