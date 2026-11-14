import { posix } from "node:path";
import { runChecks, type CheckResult } from "@lorequill/checks";
import {
  MAX_PROFILE_BYTES,
  PROFILE_RELATIVE_PATH,
  parseProfile,
  type Profile,
} from "@lorequill/profile";
import type { GitBinary } from "./git-process";
import { readCommitTree, readHead, readIndex, type Head } from "./repository";
import { headChanged } from "./status";
import { createIndexSnapshot, createTreeSnapshot, type TreeSnapshot } from "./tree-snapshot";

/** Where a repository-level check reads its files: the index, or a commit. */
export type CheckSource =
  { readonly kind: "index" } | { readonly kind: "commit"; readonly commit: string };

/** Where the folder lies in the repository, and the profile to fall back on. */
export interface CheckTarget {
  /**
   * The workspace folder relative to the repository root (POSIX, empty for the root), or
   * `undefined` when the folder is not inside the repository, as when only its content root lies
   * in a nested repository.
   */
  readonly folderPrefix: string | undefined;
  /** The content root relative to the repository root, from the working-tree profile. */
  readonly contentPrefix: string;
  /** The profile loaded from the working tree. */
  readonly workingProfile: Profile;
}

export type TreeCheck =
  | {
      readonly kind: "checked";
      /** `HEAD` when the source was read. */
      readonly head: Head;
      /** The checked tree. */
      readonly tree: string;
      /**
       * `tree`: the profile was read from the checked tree, as CI reads it. `working-tree`: the
       * profile is not in the tree, so the working-tree profile was used.
       */
      readonly profileSource: "tree" | "working-tree";
      readonly result: CheckResult;
    }
  /** The index has unmerged entries. */
  | { readonly kind: "conflicted"; readonly paths: readonly string[] }
  /** The profile in the checked tree is invalid, so the tree cannot be checked. */
  | { readonly kind: "invalid-profile"; readonly head: Head; readonly tree: string };

/**
 * The commit check (specification §7, §12): runs the profile's checks on the staged tree, or on
 * a commit's tree to verify a commit afterwards. Both read Git objects only, never unsaved
 * buffers or working-tree files. The profile comes from the checked tree when it is there, so the
 * result matches what CI computes for the commit.
 */
export async function checkTree(
  git: GitBinary,
  source: CheckSource,
  target: CheckTarget,
  signal?: AbortSignal,
): Promise<TreeCheck> {
  let head: Head;
  let tree: string;
  let snapshotAt: (prefix: string) => TreeSnapshot;
  if (source.kind === "index") {
    head = await readHead(git, signal);
    const index = await readIndex(git, signal);
    if (index.kind === "conflicted") {
      return index;
    }
    tree = index.tree;
    snapshotAt = (prefix) => createIndexSnapshot(git, index, prefix);
  } else {
    head = await readHead(git, signal);
    tree = await readCommitTree(git, source.commit, signal);
    snapshotAt = (prefix) => createTreeSnapshot(git, tree, prefix);
  }

  let profile = target.workingProfile;
  let contentPrefix = target.contentPrefix;
  let profileSource: "tree" | "working-tree" = "working-tree";
  if (target.folderPrefix !== undefined) {
    const folder = snapshotAt(target.folderPrefix);
    try {
      const text = await folder.readText(PROFILE_RELATIVE_PATH);
      if (text !== undefined) {
        const parsed = text.length > MAX_PROFILE_BYTES ? undefined : parseProfile(text);
        if (!parsed?.ok) {
          return { kind: "invalid-profile", head, tree };
        }
        profile = parsed.profile;
        profileSource = "tree";
        contentPrefix = joinPrefix(target.folderPrefix, profile.content.root);
      }
    } finally {
      folder.dispose();
    }
  }

  const snapshot = snapshotAt(contentPrefix);
  try {
    const result = await runChecks({ profile, snapshot, ...(signal ? { signal } : {}) });
    return { kind: "checked", head, tree, profileSource, result };
  } finally {
    snapshot.dispose();
  }
}

/** The content root `root` of a profile in the folder at `folderPrefix`, relative to the repository. */
export function joinPrefix(folderPrefix: string, root: string): string {
  const joined = posix.normalize(posix.join(folderPrefix === "" ? "." : folderPrefix, root));
  return joined === "." ? "" : joined.replace(/\/$/, "");
}

/** What was checked: Commit must find exactly this state before it runs. */
export interface CheckedState {
  readonly head: Head;
  readonly tree: string;
}

export type CommitOutcome =
  /** The commit exists. `verified`: its tree is the checked tree. */
  | {
      readonly kind: "committed";
      readonly commit: string;
      readonly tree: string;
      readonly verified: boolean;
    }
  /** `HEAD` or the index changed after the check; nothing was committed. */
  | { readonly kind: "changed" }
  /** Git did not create a commit, for example because a hook rejected it. */
  | { readonly kind: "failed"; readonly exitCode: number; readonly stderr: string };

/** Commits can run hooks; they get more time than plumbing commands. */
const COMMIT_TIMEOUT_MS = 10 * 60 * 1000;

/**
 * Commits the index after verifying that `HEAD` and the index tree are still the checked ones
 * (specification §12). The commit is an ordinary `git commit` with the approved message on
 * standard input: Git's configured identity, signing, and hooks apply as for any commit. Afterwards
 * the commit's tree is compared with the checked tree; a difference, for example from a hook that
 * staged more files, makes the commit unverified. Nothing is ever undone or rewritten.
 */
export async function commitChecked(
  git: GitBinary,
  message: string,
  checked: CheckedState,
  signal?: AbortSignal,
): Promise<CommitOutcome> {
  const head = await readHead(git, signal);
  const index = await readIndex(git, signal);
  if (headChanged(checked.head, head) || index.kind !== "tree" || index.tree !== checked.tree) {
    return { kind: "changed" };
  }
  const output = await git.run(["commit", "--quiet", "--file=-"], {
    input: message,
    timeoutMs: COMMIT_TIMEOUT_MS,
    ...(signal ? { signal } : {}),
  });
  const after = await readHead(git);
  if (after.kind === "unborn" || !headChanged(checked.head, after)) {
    return { kind: "failed", exitCode: output.exitCode, stderr: output.stderr };
  }
  const tree = await readCommitTree(git, after.commit);
  return { kind: "committed", commit: after.commit, tree, verified: tree === checked.tree };
}
