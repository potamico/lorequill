import type { Head } from "../git/repository";
import { HostError, type Review, type ReviewHost } from "./review-host";

/** What is known locally before submitting. */
export interface SubmitFacts {
  readonly head: Head;
  /** `review.base_branch` of the profile; the host's default branch when absent. */
  readonly baseBranch?: string | undefined;
  /** The review state blocks Submit. */
  readonly reviewBlocked: boolean;
  readonly conflicted: boolean;
  /** Staged changes that are not committed; they are not part of the submission. */
  readonly stagedChanges: boolean;
  readonly remotes: readonly RemoteFacts[];
  /** Remote of the branch's upstream, if it has one. */
  readonly upstreamRemote?: string | undefined;
}

export interface RemoteFacts {
  readonly name: string;
  /** Push URL, or the fetch URL when there is no separate push URL. */
  readonly url: string;
}

export interface CommitSummary {
  readonly id: string;
  readonly subject: string;
}

/** Everything the author confirms before the first remote write (§12). */
export interface SubmitPlan {
  readonly host: string;
  readonly remote: string;
  readonly branch: string;
  readonly base: string;
  /** The commits of the branch that are not on the base branch, newest first. */
  readonly commits: readonly CommitSummary[];
  /** More commits exist than listed. */
  readonly truncated: boolean;
  /** The open review that will be updated instead of creating one. */
  readonly existing?: Review;
  readonly stagedChanges: boolean;
  readonly defaultTitle: string;
}

export type PushFailure =
  /** The remote branch has commits that are not local: diverged, never force-pushed. */
  "rejected" | "auth" | "network" | "failed";

export class PushError extends Error {
  constructor(
    readonly kind: PushFailure,
    readonly detail = "",
  ) {
    super(`Push failed: ${kind}`);
    this.name = "PushError";
  }
}

/** Local and remote operations of a submission, provided by the editor or by tests. */
export interface SubmitPorts {
  /** Asks the author to choose among several remotes; `undefined` when cancelled. */
  chooseRemote(remotes: readonly RemoteFacts[]): Promise<string | undefined>;
  /** The review host of a remote, or `undefined` if its host is not supported. */
  hostFor(remote: RemoteFacts): ReviewHost | undefined;
  /** Updates the remote-tracking ref of the base branch. Throws a {@link PushError} kind. */
  fetchBase(remote: string, base: string): Promise<void>;
  /** Commits on `HEAD` that are not on `remote/base`; `undefined` if that ref does not exist. */
  commitsSince(
    remote: string,
    base: string,
  ): Promise<{ readonly commits: CommitSummary[]; readonly truncated: boolean } | undefined>;
  /** Shows the plan; resolves with the review title, or `undefined` when cancelled. */
  confirm(plan: SubmitPlan): Promise<{ readonly title: string } | undefined>;
  /** Pushes the branch without force. Throws a {@link PushError}. */
  push(remote: string, branch: string, setUpstream: boolean): Promise<void>;
  /**
   * `HEAD` is on the base branch: explains that changes are submitted from their own branch, and
   * with the author's consent creates and checks out a new branch at `HEAD`, carrying along the
   * commits and uncommitted changes, then moves the local base branch back to `remote/base`, since
   * its own commits are now on the new branch. Resolves with the new branch's name, or `undefined`
   * when declined.
   */
  branchOff(
    remote: string,
    base: string,
    commits: readonly CommitSummary[],
  ): Promise<string | undefined>;
}

export type BlockReason =
  | "detached-head"
  | "unborn-branch"
  | "unverified"
  | "conflicts"
  | "no-remote"
  | "unsupported-host"
  | "no-push-access"
  | "no-base"
  | "no-commits";

export type SubmitOutcome =
  | { readonly kind: "blocked"; readonly reason: BlockReason; readonly base?: string }
  /** A review for these branches was closed or merged; a new branch is needed (§12). */
  | { readonly kind: "closed-review"; readonly review: Review }
  | { readonly kind: "cancelled" }
  | { readonly kind: "fetch-failed"; readonly failure: PushFailure; readonly detail: string }
  | { readonly kind: "push-failed"; readonly failure: PushFailure; readonly detail: string }
  | {
      readonly kind: "host-failed";
      readonly error: HostError;
      /** The branch was pushed before the failure; a retry pushes nothing new. */
      readonly pushed: boolean;
    }
  | {
      readonly kind: "submitted";
      readonly review: Review;
      /** `false` when an existing open review was reused. */
      readonly created: boolean;
      readonly host: string;
    };

/**
 * `Submit for Review` (specification §12): checks the branch, resolves and verifies the
 * remote and host, shows the destination and every commit of the branch, pushes without force,
 * and creates a review or reuses the open one. On the base branch, it offers to move the work to a
 * new branch first, and never submits from the base branch itself. A retry after any failure repeats the same steps:
 * pushing again is harmless and an existing open review is found, so no duplicate is created. A
 * closed or merged review is never reopened or reused. Nothing local is rewritten; only after
 * branching off does the local base branch return to the remote, its commits kept on the branch.
 */
export async function submit(facts: SubmitFacts, ports: SubmitPorts): Promise<SubmitOutcome> {
  let { head } = facts;
  let upstreamRemote = facts.upstreamRemote;
  if (head.kind === "detached") {
    return { kind: "blocked", reason: "detached-head" };
  }
  if (head.kind === "unborn") {
    return { kind: "blocked", reason: "unborn-branch" };
  }
  if (facts.conflicted) {
    return { kind: "blocked", reason: "conflicts" };
  }
  if (facts.reviewBlocked) {
    return { kind: "blocked", reason: "unverified" };
  }
  if (facts.remotes.length === 0) {
    return { kind: "blocked", reason: "no-remote" };
  }
  const remoteName =
    facts.remotes.find(({ name }) => name === facts.upstreamRemote)?.name ??
    facts.remotes.find(({ name }) => name === "origin")?.name ??
    (facts.remotes.length === 1 ? facts.remotes[0]?.name : await ports.chooseRemote(facts.remotes));
  const remote = facts.remotes.find(({ name }) => name === remoteName);
  if (!remote) {
    return { kind: "cancelled" };
  }
  const host = ports.hostFor(remote);
  if (!host) {
    return { kind: "blocked", reason: "unsupported-host" };
  }

  let base: string;
  try {
    const repository = await host.repository();
    if (!repository.canPush) {
      return { kind: "blocked", reason: "no-push-access" };
    }
    base = facts.baseBranch ?? repository.defaultBranch;
  } catch (error) {
    return hostFailed(error, false);
  }

  try {
    await ports.fetchBase(remote.name, base);
  } catch (error) {
    const failure = error instanceof PushError ? error : new PushError("failed");
    return { kind: "fetch-failed", failure: failure.kind, detail: failure.detail };
  }
  const listed = await ports.commitsSince(remote.name, base);
  if (!listed) {
    return { kind: "blocked", reason: "no-base", base };
  }
  if (listed.commits.length === 0) {
    return { kind: "blocked", reason: "no-commits", base };
  }
  if (head.branch === base) {
    // Only offered when there is something to submit, so no empty branch is left behind.
    const branch = await ports.branchOff(remote.name, base, listed.commits);
    if (branch === undefined || branch === base) {
      return { kind: "cancelled" };
    }
    head = { ...head, branch };
    upstreamRemote = undefined;
  }

  let existing: Review | undefined;
  try {
    const reviews = await host.findReviews(head.branch, base);
    existing = reviews.find(({ state }) => state === "open");
    if (!existing) {
      const previous = [...reviews].sort((a, b) => b.number - a.number)[0];
      if (previous) {
        return { kind: "closed-review", review: previous };
      }
    }
  } catch (error) {
    return hostFailed(error, false);
  }

  const plan: SubmitPlan = {
    host: host.label,
    remote: remote.name,
    branch: head.branch,
    base,
    commits: listed.commits,
    truncated: listed.truncated,
    ...(existing ? { existing } : {}),
    stagedChanges: facts.stagedChanges,
    defaultTitle:
      listed.commits.length === 1 && !listed.truncated
        ? (listed.commits[0]?.subject ?? head.branch)
        : head.branch,
  };
  const confirmed = await ports.confirm(plan);
  if (!confirmed) {
    return { kind: "cancelled" };
  }

  try {
    await ports.push(remote.name, head.branch, upstreamRemote === undefined);
  } catch (error) {
    const failure = error instanceof PushError ? error : new PushError("failed");
    return { kind: "push-failed", failure: failure.kind, detail: failure.detail };
  }

  if (existing) {
    return { kind: "submitted", review: existing, created: false, host: host.label };
  }
  try {
    const review = await host.createReview({
      branch: head.branch,
      base,
      title: confirmed.title,
      body: reviewBody(plan),
    });
    return { kind: "submitted", review, created: true, host: host.label };
  } catch (error) {
    if (error instanceof HostError && error.kind === "already-exists") {
      // Created in the meantime, for example by an earlier attempt whose answer was lost.
      try {
        const open = (await host.findReviews(head.branch, base)).find(
          ({ state }) => state === "open",
        );
        if (open) {
          return { kind: "submitted", review: open, created: false, host: host.label };
        }
      } catch (retryError) {
        return hostFailed(retryError, true);
      }
    }
    return hostFailed(error, true);
  }
}

function hostFailed(error: unknown, pushed: boolean): SubmitOutcome {
  return {
    kind: "host-failed",
    error: error instanceof HostError ? error : new HostError("unexpected"),
    pushed,
  };
}

/** The review description: the branch's commits, so reviewers see what is included. */
export function reviewBody(plan: SubmitPlan): string {
  const lines = plan.commits.map(({ id, subject }) => `- ${subject} (${id.slice(0, 7)})`);
  if (plan.truncated) {
    lines.push("- …");
  }
  return `${lines.join("\n")}\n\nSubmitted with Lorequill.\n`;
}

/** The log code of an outcome: its kind, or the reason it was blocked. */
export type SubmitLogCode = SubmitOutcome["kind"] | BlockReason;

export function submitLogCode(outcome: SubmitOutcome): SubmitLogCode {
  return outcome.kind === "blocked" ? outcome.reason : outcome.kind;
}
