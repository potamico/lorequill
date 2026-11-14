import {
  HostError,
  type HostRepository,
  type NewReview,
  type Review,
  type ReviewHost,
} from "./review-host";

/** Failures a test makes the mock host produce, once each. */
export interface MockFailures {
  repository?: HostError | undefined;
  findReviews?: HostError | undefined;
  createReview?: HostError | undefined;
}

/**
 * An in-memory review host for tests. It behaves like GitHub for the
 * operations Lorequill uses: one open review per source and target branch, closed and merged
 * reviews kept, and an `already-exists` error for a duplicate.
 */
export class MockReviewHost implements ReviewHost {
  readonly label: string;
  readonly reviews: (Review & { readonly branch: string; readonly base: string })[] = [];
  readonly calls: string[] = [];
  failures: MockFailures = {};
  canPush = true;
  /** Simulates a review that another tool created while Lorequill was asking. */
  createConcurrently = false;

  constructor(
    label = "example.test/owner/repo",
    private readonly defaultBranch = "main",
  ) {
    this.label = label;
  }

  repository(): Promise<HostRepository> {
    this.calls.push("repository");
    this.fail("repository");
    return Promise.resolve({ defaultBranch: this.defaultBranch, canPush: this.canPush });
  }

  findReviews(branch: string, base: string): Promise<Review[]> {
    this.calls.push(`findReviews ${branch} ${base}`);
    this.fail("findReviews");
    return Promise.resolve(
      this.reviews.filter((review) => review.branch === branch && review.base === base),
    );
  }

  createReview(input: NewReview): Promise<Review> {
    this.calls.push(`createReview ${input.branch} ${input.base}`);
    if (this.createConcurrently) {
      this.createConcurrently = false;
      this.add(input.branch, input.base, "open", "Created elsewhere");
    }
    this.fail("createReview");
    if (
      this.reviews.some(
        (r) => r.branch === input.branch && r.base === input.base && r.state === "open",
      )
    ) {
      return Promise.reject(new HostError("already-exists", "A pull request already exists"));
    }
    return Promise.resolve(this.add(input.branch, input.base, "open", input.title));
  }

  /** Makes the next review creation fail like a server error. */
  failNextCreate(): void {
    this.failures.createReview = new HostError("unexpected", "Simulated failure");
  }

  /** Adds a review as if it had been created on the host. */
  add(branch: string, base: string, state: Review["state"], title = "Review"): Review {
    const number = this.reviews.length + 1;
    const review = {
      number,
      url: `https://example.test/owner/repo/pull/${String(number)}`,
      state,
      title,
      branch,
      base,
    };
    this.reviews.push(review);
    return review;
  }

  private fail(operation: keyof MockFailures): void {
    const failure = this.failures[operation];
    if (failure) {
      this.failures[operation] = undefined;
      throw failure;
    }
  }
}
