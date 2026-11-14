import type { Locale } from "../i18n";

/** A changed file of a repository, as the commit dialog lists it. */
export interface ChangedFile {
  /** POSIX path relative to the repository root. */
  readonly path: string;
  /** The file has staged changes. */
  readonly staged: boolean;
  /** The file has changes that are not staged (including an untracked file). */
  readonly unstaged: boolean;
  /** The file is not tracked by Git. */
  readonly untracked: boolean;
}

/** How the dialog presents a file. */
export interface DialogEntry {
  readonly file: ChangedFile;
  /** Selected when the dialog opens: exactly the staged files. */
  readonly picked: boolean;
  /** Staged before the dialog opened, by the author or another tool. */
  readonly preStaged: boolean;
  /** Only the staged part will be committed; the rest stays unstaged. */
  readonly partiallyStaged: boolean;
  /** Outside the folder's content root, so the commit check does not cover it (§12). */
  readonly outsideContentRoot: boolean;
}

/** Whether `path` (repository-relative) lies below `prefix` (empty for the repository root). */
export function isBelow(path: string, prefix: string): boolean {
  return prefix === "" || path.startsWith(`${prefix}/`);
}

/**
 * The entries of the commit dialog (decision D25), sorted by path: staged files are selected
 * and marked as already staged, files outside the content root are marked as not checked.
 */
export function dialogEntries(files: readonly ChangedFile[], contentPrefix: string): DialogEntry[] {
  return [...files]
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
    .map((file) => ({
      file,
      picked: file.staged,
      preStaged: file.staged,
      partiallyStaged: file.staged && file.unstaged,
      outsideContentRoot: !isBelow(file.path, contentPrefix),
    }));
}

/** Index changes that turn the dialog selection into the staged set. */
export interface SelectionPlan {
  /** Files to stage as a whole: selected, but not staged yet. */
  readonly stage: readonly string[];
  /** Files to unstage as a whole: staged, but no longer selected. */
  readonly unstage: readonly string[];
  /**
   * Files staged before the dialog opened that lie outside the content root and stay selected.
   * The author confirms their inclusion explicitly (§12).
   */
  readonly confirm: readonly string[];
  /** Nothing would be committed. */
  readonly empty: boolean;
}

/**
 * Stages and unstages whole files only (specification §12). A selected file that is already
 * staged is left as it is, so a partially staged file keeps its unstaged part out of the commit.
 */
export function planSelection(
  entries: readonly DialogEntry[],
  selected: ReadonlySet<string>,
): SelectionPlan {
  const stage: string[] = [];
  const unstage: string[] = [];
  const confirm: string[] = [];
  for (const entry of entries) {
    const path = entry.file.path;
    if (selected.has(path)) {
      if (!entry.file.staged) {
        stage.push(path);
      } else if (entry.preStaged && entry.outsideContentRoot) {
        confirm.push(path);
      }
    } else if (entry.file.staged) {
      unstage.push(path);
    }
  }
  return { stage, unstage, confirm, empty: !entries.some(({ file }) => selected.has(file.path)) };
}

const DEFAULT_MESSAGES: Readonly<Record<Locale, string>> = {
  en: "docs: update content",
  "de-CH": "docs: Inhalt aktualisieren",
};

/**
 * The editable default commit message (specification §12) in the profile's content locale,
 * because it is written into the repository.
 */
export function defaultCommitMessage(contentLocale: Locale): string {
  return DEFAULT_MESSAGES[contentLocale];
}

/** How a commit attempt ended, for tests and logs. */
export type CommitFlowResult =
  | "cancelled"
  | "unavailable"
  | "detached"
  | "conflicted"
  | "nothing-to-commit"
  | "invalid-profile"
  | "check-failed"
  | "check-incomplete"
  | "changed"
  | "failed"
  | "committed"
  | "unverified";

/** How a verification of the current commit ended. */
export type VerifyResult = "unavailable" | "no-commit" | "verified" | "verification-failed";
