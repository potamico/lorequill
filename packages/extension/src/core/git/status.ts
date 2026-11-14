import type { Head } from "./repository";

/**
 * A repository state that Commit or Submit must explain instead of working around
 * (specification §12): no destructive fallback, only an explicit message.
 */
export type RepositoryProblem =
  /** `HEAD` is not on a branch; nothing can be submitted from it. */
  | "detached-head"
  /** The branch has no commit yet. Committing is possible; submitting needs a commit. */
  | "unborn-branch"
  /** No remote is configured, so nothing can be submitted. */
  | "no-remote"
  /** The current branch is the profile's base branch, from which nothing is submitted. */
  | "on-base-branch"
  /** The index has unmerged entries; no tree can be checked or committed. */
  | "conflicts";

export interface RepositoryFacts {
  readonly head: Head;
  readonly remotes: readonly string[];
  readonly conflicted: number;
  /** `review.base_branch` of the profile, if any. */
  readonly baseBranch?: string | undefined;
}

/** The problems of a repository state, in a fixed order. */
export function repositoryProblems(facts: RepositoryFacts): RepositoryProblem[] {
  const problems: RepositoryProblem[] = [];
  if (facts.head.kind === "detached") {
    problems.push("detached-head");
  } else {
    if (facts.head.kind === "unborn") {
      problems.push("unborn-branch");
    }
    if (facts.baseBranch !== undefined && facts.head.branch === facts.baseBranch) {
      problems.push("on-base-branch");
    }
  }
  if (facts.remotes.length === 0) {
    problems.push("no-remote");
  }
  if (facts.conflicted > 0) {
    problems.push("conflicts");
  }
  return problems;
}

/** Whether two `HEAD` states differ: another branch, or another commit on the same branch. */
export function headChanged(previous: Head, current: Head): boolean {
  if (previous.kind !== current.kind) {
    return true;
  }
  const commitOf = (head: Head): string | undefined =>
    head.kind === "unborn" ? undefined : head.commit;
  const branchOf = (head: Head): string | undefined =>
    head.kind === "detached" ? undefined : head.branch;
  return commitOf(previous) !== commitOf(current) || branchOf(previous) !== branchOf(current);
}
