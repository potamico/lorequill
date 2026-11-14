/**
 * The repository-level review state (specification §12): the outcome of the last Lorequill
 * commit or commit verification in one repository. It is not a property of a page.
 */
export type ReviewState =
  /** The commit's tree passed the commit check (at commit time, or verified afterwards). */
  | { readonly kind: "verified"; readonly commit: string }
  /**
   * **Commit not verified**: the commit's tree differs from the checked tree, for example
   * because a hook changed the index. Submit stays blocked until the committed tree is checked.
   */
  | { readonly kind: "unverified"; readonly commit: string }
  /** The committed tree was checked and has findings; a corrective commit is needed. */
  | { readonly kind: "verification-failed"; readonly commit: string; readonly findings: number };

/**
 * Whether Submit is blocked. An unverified or failed state blocks until a later commit passes
 * the commit check or a check of the current commit passes; neither ever rewrites history.
 */
export function blocksSubmit(state: ReviewState | undefined): boolean {
  return state !== undefined && state.kind !== "verified";
}

/** Parses a persisted state; anything unexpected counts as no state. */
export function parseReviewState(value: unknown): ReviewState | undefined {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }
  const { kind, commit, findings } = value as Record<string, unknown>;
  if (typeof commit !== "string" || !/^[0-9a-f]{40}(?:[0-9a-f]{24})?$/.test(commit)) {
    return undefined;
  }
  if (kind === "verified" || kind === "unverified") {
    return { kind, commit };
  }
  if (kind === "verification-failed" && typeof findings === "number" && findings >= 0) {
    return { kind, commit, findings };
  }
  return undefined;
}
