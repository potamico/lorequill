/**
 * The Git host side of `Submit for Review` (specification §12, §13): a pull or merge request
 * per source branch and target branch. Implementations: GitHub (and GitHub Enterprise Server) and
 * a mock for tests; GitLab follows later with the same interface.
 */
export interface ReviewHost {
  /** What the author sees as the destination, for example `github.com/owner/repo`. */
  readonly label: string;
  /** The repository's default branch and whether the signed-in user can push to it. */
  repository(): Promise<HostRepository>;
  /** Every review (open, closed, or merged) from `branch` into `base` of this repository. */
  findReviews(branch: string, base: string): Promise<Review[]>;
  /** Creates a review. Fails with `already-exists` if an open one exists for the same branches. */
  createReview(input: NewReview): Promise<Review>;
}

export interface HostRepository {
  readonly defaultBranch: string;
  readonly canPush: boolean;
}

export interface Review {
  readonly number: number;
  /** Web address of the review on the host; always on the host's own web origin. */
  readonly url: string;
  readonly state: "open" | "closed" | "merged";
  readonly title: string;
}

export interface NewReview {
  readonly branch: string;
  readonly base: string;
  readonly title: string;
  readonly body: string;
}

export type HostErrorKind =
  /** Not signed in, or the token was rejected. */
  | "auth"
  /** Signed in, but not allowed. */
  | "forbidden"
  /** The repository does not exist or is not visible to the user. */
  | "not-found"
  | "rate-limited"
  /** The host could not be reached or did not answer in time. */
  | "network"
  /** An open review for the same branches exists already. */
  | "already-exists"
  /** The host rejected the request, for example because there are no commits to review. */
  | "invalid"
  /** Anything else, including answers that are not what the API documents. */
  | "unexpected";

/** A host request failed. `detail` is the host's own message, shown but never logged. */
export class HostError extends Error {
  constructor(
    readonly kind: HostErrorKind,
    readonly detail = "",
  ) {
    super(`Host request failed: ${kind}`);
    this.name = "HostError";
  }
}
