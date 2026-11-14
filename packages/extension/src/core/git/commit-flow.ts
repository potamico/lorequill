import type { CheckResult } from "@lorequill/checks";
import type { CheckedState, CommitOutcome, TreeCheck } from "./commit";
import {
  dialogEntries,
  planSelection,
  type ChangedFile,
  type CommitFlowResult,
  type DialogEntry,
  type VerifyResult,
} from "./commit-plan";
import type { Head } from "./repository";
import type { ReviewState } from "./review-state";

/** What is known locally before the commit dialog opens. */
export interface CommitFacts {
  readonly head: Head;
  readonly conflicted: boolean;
  readonly files: readonly ChangedFile[];
  /** The content root relative to the repository root (empty for the root). */
  readonly contentPrefix: string;
  /** The editable default message, in the content locale. */
  readonly defaultMessage: string;
}

/** What the author sees when asked for the commit message. */
export interface MessageRequest {
  readonly branch: string;
  readonly profileSource: "tree" | "working-tree";
  readonly pagesChecked: number;
  readonly defaultMessage: string;
}

/** Prompts and repository operations of a commit, provided by the editor or by tests. */
export interface CommitPorts {
  /** The multi-select dialog; the selected repository-relative paths, `undefined` when cancelled. */
  chooseFiles(
    entries: readonly DialogEntry[],
    branch: string,
  ): Promise<ReadonlySet<string> | undefined>;
  /** Confirms pre-staged files outside the content root, which the check does not cover. */
  confirmUnchecked(paths: readonly string[]): Promise<boolean>;
  stage(paths: readonly string[]): Promise<void>;
  unstage(paths: readonly string[]): Promise<void>;
  hasStagedChanges(): Promise<boolean>;
  /** The commit check on the staged tree. */
  check(): Promise<TreeCheck>;
  /** Records the result of a completed commit check, before anything else is asked. */
  recordCheck(result: CheckResult): void;
  askMessage(request: MessageRequest): Promise<string | undefined>;
  commit(message: string, checked: CheckedState): Promise<CommitOutcome>;
}

export type CommitFlowOutcome =
  | { readonly kind: "detached" }
  | { readonly kind: "conflicted" }
  | { readonly kind: "nothing-to-commit"; readonly reason: "no-changes" | "empty-selection" }
  | { readonly kind: "cancelled" }
  /** The staged tree could not be checked. */
  | { readonly kind: "unchecked"; readonly check: Exclude<TreeCheck, { kind: "checked" }> }
  /** The commit check found problems or could not complete; nothing was committed. */
  | { readonly kind: "check-blocked"; readonly result: CheckResult }
  | { readonly kind: "changed" }
  | { readonly kind: "failed"; readonly exitCode: number; readonly stderr: string }
  | {
      readonly kind: "committed";
      readonly commit: string;
      readonly branch: string;
      /** The commit's tree is the checked tree. */
      readonly verified: boolean;
    };

/**
 * `Commit` (specification §12, decision D25): the dialog over the existing Git index, which
 * stages and unstages whole files only, the commit check on the staged tree, the message, and
 * the commit that verifies nothing changed since the check. Nothing is ever undone or rewritten.
 */
export async function commitFlow(
  facts: CommitFacts,
  ports: CommitPorts,
): Promise<CommitFlowOutcome> {
  const { head } = facts;
  if (head.kind === "detached") {
    return { kind: "detached" };
  }
  if (facts.conflicted) {
    return { kind: "conflicted" };
  }
  if (facts.files.length === 0) {
    return { kind: "nothing-to-commit", reason: "no-changes" };
  }

  const entries = dialogEntries(facts.files, facts.contentPrefix);
  const selected = await ports.chooseFiles(entries, head.branch);
  if (!selected) {
    return { kind: "cancelled" };
  }
  const plan = planSelection(entries, selected);
  if (plan.empty) {
    return { kind: "nothing-to-commit", reason: "empty-selection" };
  }
  if (plan.confirm.length > 0 && !(await ports.confirmUnchecked(plan.confirm))) {
    return { kind: "cancelled" };
  }
  if (plan.unstage.length > 0) {
    await ports.unstage(plan.unstage);
  }
  if (plan.stage.length > 0) {
    await ports.stage(plan.stage);
  }
  if (!(await ports.hasStagedChanges())) {
    return { kind: "nothing-to-commit", reason: "empty-selection" };
  }

  const check = await ports.check();
  if (check.kind !== "checked") {
    return { kind: "unchecked", check };
  }
  ports.recordCheck(check.result);
  if (check.result.status !== "passed") {
    return { kind: "check-blocked", result: check.result };
  }

  const message = await ports.askMessage({
    branch: head.branch,
    profileSource: check.profileSource,
    pagesChecked: check.result.pagesChecked,
    defaultMessage: facts.defaultMessage,
  });
  if (message === undefined || message.trim() === "") {
    return { kind: "cancelled" };
  }
  const outcome = await ports.commit(message, check);
  switch (outcome.kind) {
    case "changed":
      return { kind: "changed" };
    case "failed":
      return { kind: "failed", exitCode: outcome.exitCode, stderr: outcome.stderr };
    case "committed":
      return {
        kind: "committed",
        commit: outcome.commit,
        branch: head.branch,
        verified: outcome.verified,
      };
  }
}

/** The result code of a commit attempt, for tests and logs. */
export function commitFlowResult(outcome: CommitFlowOutcome): CommitFlowResult {
  switch (outcome.kind) {
    case "unchecked":
      return outcome.check.kind;
    case "check-blocked":
      return outcome.result.status === "error" ? "check-incomplete" : "check-failed";
    case "committed":
      return outcome.verified ? "committed" : "unverified";
    default:
      return outcome.kind;
  }
}

/** The review state a commit leaves behind, if it created one. */
export function reviewStateAfterCommit(outcome: CommitFlowOutcome): ReviewState | undefined {
  return outcome.kind === "committed"
    ? { kind: outcome.verified ? "verified" : "unverified", commit: outcome.commit }
    : undefined;
}

export type VerifyOutcome =
  | { readonly kind: "no-commit" }
  | { readonly kind: "verified"; readonly commit: string }
  /** The commit's tree has findings, or could not be checked completely. */
  | { readonly kind: "verification-failed"; readonly commit: string; readonly check: TreeCheck };

/**
 * `Check Commit` (specification §12): checks the tree of the current commit, so a commit that a
 * hook changed can clear **Commit not verified** without rewriting history.
 */
export async function verifyFlow(
  head: Head,
  check: (commit: string) => Promise<TreeCheck>,
): Promise<VerifyOutcome> {
  if (head.kind === "unborn") {
    return { kind: "no-commit" };
  }
  const result = await check(head.commit);
  return result.kind === "checked" && result.result.status === "passed"
    ? { kind: "verified", commit: head.commit }
    : { kind: "verification-failed", commit: head.commit, check: result };
}

export function verifyResult(outcome: VerifyOutcome): VerifyResult {
  return outcome.kind;
}

/** The review state a verification leaves behind. */
export function reviewStateAfterVerify(outcome: VerifyOutcome): ReviewState | undefined {
  switch (outcome.kind) {
    case "no-commit":
      return undefined;
    case "verified":
      return { kind: "verified", commit: outcome.commit };
    case "verification-failed":
      return {
        kind: "verification-failed",
        commit: outcome.commit,
        findings: outcome.check.kind === "checked" ? outcome.check.result.findings.length : 0,
      };
  }
}
