import picomatch from "picomatch";
import type { ContentSettings } from "./generated/profile";

/**
 * Glob options for `content.include`, `content.exclude`, and `content.drafts`.
 *
 * - Paths are always POSIX-style and relative to the content root, so backslashes are never
 *   separators (`windows: false`; in a pattern a backslash escapes the next character).
 * - Dotfiles and dot directories are matched only by patterns that name the dot explicitly.
 * - Negation (`!pattern`) and extended globs (`+(a|b)`) are disabled. Include and exclude already
 *   express negation, and extended globs add regular-expression power that the profile must not
 *   offer (specification section 6).
 */
const GLOB_OPTIONS: picomatch.PicomatchOptions = {
  windows: false,
  dot: false,
  nonegate: true,
  noextglob: true,
};

/** Decides which files below the content root are pages (specification sections 3 and 8). */
export interface ContentScope {
  /**
   * Whether a file is an included page: it matches at least one `include` pattern and no
   * `exclude` pattern.
   *
   * @param relativePath POSIX path relative to the content root, for example `guides/setup.md`.
   */
  isIncluded(relativePath: string): boolean;
  /**
   * Whether a file is a draft: it matches a `drafts` pattern. Drafts are checked like other
   * pages but not published; any file can be one, not only a page.
   *
   * @param relativePath POSIX path relative to the content root.
   */
  isDraft(relativePath: string): boolean;
}

function compile(patterns: readonly string[]): (relativePath: string) => boolean {
  if (patterns.length === 0) {
    return () => false;
  }
  return picomatch([...patterns], GLOB_OPTIONS);
}

/**
 * Compiles the `include`, `exclude`, and `drafts` patterns of a validated profile.
 *
 * A pattern matches the complete relative path. `*.md` therefore selects only files directly in
 * the content root, while a pattern that starts with a globstar directory selects files at any
 * depth. A pattern such as `drafts` does not exclude the files below a directory named `drafts`;
 * name them with a descendant pattern for that.
 *
 * The patterns must come from a validated profile. An empty pattern throws.
 */
export function createContentScope(
  content: Pick<ContentSettings, "include" | "exclude" | "drafts">,
): ContentScope {
  const include = compile(content.include);
  const exclude = compile(content.exclude ?? []);
  const drafts = compile(content.drafts ?? []);
  return {
    isIncluded: (relativePath) => include(relativePath) && !exclude(relativePath),
    isDraft: (relativePath) => drafts(relativePath),
  };
}
