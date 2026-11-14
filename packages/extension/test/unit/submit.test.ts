import { describe, expect, it } from "vitest";
import {
  gitHubTargetFor,
  GitHubHost,
  parseRemoteUrl,
  type GitHubTarget,
} from "../../src/core/host/github";
import { MockReviewHost } from "../../src/core/host/mock-host";
import { HostError } from "../../src/core/host/review-host";
import {
  PushError,
  reviewBody,
  submit,
  type SubmitFacts,
  type SubmitPlan,
  type SubmitPorts,
} from "../../src/core/host/submit";

const commit = "a".repeat(40);

function facts(overrides: Partial<SubmitFacts> = {}): SubmitFacts {
  return {
    head: { kind: "branch", branch: "feature/docs", commit },
    baseBranch: "main",
    reviewBlocked: false,
    conflicted: false,
    stagedChanges: false,
    remotes: [{ name: "origin", url: "https://github.com/owner/repo.git" }],
    upstreamRemote: "origin",
    ...overrides,
  };
}

/** Ports backed by a mock host and a scripted local repository. */
function ports(host: MockReviewHost) {
  const log: string[] = [];
  const state = {
    commits: [
      { id: "b".repeat(40), subject: "docs: second page" },
      { id: "c".repeat(40), subject: "docs: first page" },
    ],
    baseExists: true,
    pushFailure: undefined as PushError | undefined,
    fetchFailure: undefined as PushError | undefined,
    answer: { title: "Docs" } as { title: string } | undefined,
    plans: [] as SubmitPlan[],
    /** The branch name answered when submitting from the base branch. */
    branch: undefined as string | undefined,
  };
  const value: SubmitPorts = {
    chooseRemote: (remotes) => Promise.resolve(remotes[1]?.name),
    hostFor: (remote) => (remote.url.includes("github.com") ? host : undefined),
    fetchBase: (remote, base) => {
      log.push(`fetch ${remote} ${base}`);
      const failure = state.fetchFailure;
      state.fetchFailure = undefined;
      return failure ? Promise.reject(failure) : Promise.resolve();
    },
    commitsSince: () =>
      Promise.resolve(state.baseExists ? { commits: state.commits, truncated: false } : undefined),
    confirm: (plan) => {
      state.plans.push(plan);
      return Promise.resolve(state.answer);
    },
    push: (remote, branch, setUpstream) => {
      log.push(`push ${remote} ${branch}${setUpstream ? " -u" : ""}`);
      const failure = state.pushFailure;
      state.pushFailure = undefined;
      return failure ? Promise.reject(failure) : Promise.resolve();
    },
    branchOff: (_remote, base, commits) => {
      log.push(`branch off ${base} (${String(commits.length)} commits)`);
      return Promise.resolve(state.branch);
    },
  };
  return { ports: value, log, state };
}

describe("submit", () => {
  it("pushes and creates one review containing every commit of the branch", async () => {
    const host = new MockReviewHost();
    const { ports: p, log, state } = ports(host);
    const outcome = await submit(facts(), p);

    expect(outcome).toMatchObject({ kind: "submitted", created: true, review: { number: 1 } });
    expect(log).toEqual(["fetch origin main", "push origin feature/docs"]);
    expect(state.plans[0]).toMatchObject({
      host: "example.test/owner/repo",
      remote: "origin",
      branch: "feature/docs",
      base: "main",
      defaultTitle: "feature/docs",
    });
    expect(state.plans[0]?.commits).toHaveLength(2);
    expect(host.reviews).toHaveLength(1);
  });

  it("blocks a detached HEAD, an unborn branch, conflicts, and unverified commits", async () => {
    const host = new MockReviewHost();
    const cases: [Partial<SubmitFacts>, string][] = [
      [{ head: { kind: "detached", commit } }, "detached-head"],
      [{ head: { kind: "unborn", branch: "x" } }, "unborn-branch"],
      [{ conflicted: true }, "conflicts"],
      [{ reviewBlocked: true }, "unverified"],
      [{ remotes: [] }, "no-remote"],
      [{ remotes: [{ name: "origin", url: "https://gitlab.com/o/r.git" }] }, "unsupported-host"],
    ];
    for (const [overrides, reason] of cases) {
      const { ports: p, log } = ports(host);
      expect(await submit(facts(overrides), p)).toMatchObject({ kind: "blocked", reason });
      expect(log).toEqual([]);
    }
    expect(host.reviews).toEqual([]);
  });

  it("moves work on the base branch to a new branch and submits that one", async () => {
    const host = new MockReviewHost();
    const { ports: p, log, state } = ports(host);
    state.branch = "update-glossary";
    const onMain = facts({ head: { kind: "branch", branch: "main", commit } });
    const outcome = await submit(onMain, p);

    expect(outcome).toMatchObject({ kind: "submitted", created: true });
    // The new branch has no upstream yet, so the push sets it.
    expect(log).toEqual([
      "fetch origin main",
      "branch off main (2 commits)",
      "push origin update-glossary -u",
    ]);
    expect(state.plans[0]).toMatchObject({ branch: "update-glossary", base: "main" });
    expect(host.calls).toContain("createReview update-glossary main");
  });

  it("submits nothing from the base branch when the author declines a new branch", async () => {
    const host = new MockReviewHost();
    const { ports: p, log } = ports(host);
    const onMain = facts({ head: { kind: "branch", branch: "main", commit } });
    expect(await submit(onMain, p)).toEqual({ kind: "cancelled" });
    expect(log).toEqual(["fetch origin main", "branch off main (2 commits)"]);
    expect(host.reviews).toEqual([]);
  });

  it("offers no branch when the base branch has nothing to submit", async () => {
    const host = new MockReviewHost();
    const { ports: p, log, state } = ports(host);
    state.commits = [];
    const onMain = facts({ head: { kind: "branch", branch: "main", commit } });
    expect(await submit(onMain, p)).toMatchObject({ kind: "blocked", reason: "no-commits" });
    expect(log).toEqual(["fetch origin main"]);
  });

  it("uses the host's default branch when the profile names none, also for branching off", async () => {
    const host = new MockReviewHost("h", "develop");
    const { ports: p, log } = ports(host);
    expect(
      await submit(
        facts({ baseBranch: undefined, head: { kind: "branch", branch: "develop", commit } }),
        p,
      ),
    ).toEqual({ kind: "cancelled" });
    expect(log).toContain("branch off develop (2 commits)");
  });

  it("blocks without push access, without commits, and without a base branch on the remote", async () => {
    const host = new MockReviewHost();
    host.canPush = false;
    expect(await submit(facts(), ports(host).ports)).toMatchObject({ reason: "no-push-access" });
    host.canPush = true;

    const empty = ports(host);
    empty.state.commits = [];
    expect(await submit(facts(), empty.ports)).toMatchObject({ reason: "no-commits" });

    const noBase = ports(host);
    noBase.state.baseExists = false;
    expect(await submit(facts(), noBase.ports)).toMatchObject({ reason: "no-base" });
  });

  it("reuses an open review and only pushes", async () => {
    const host = new MockReviewHost();
    host.add("feature/docs", "main", "open");
    const { ports: p, state } = ports(host);
    expect(await submit(facts(), p)).toMatchObject({
      kind: "submitted",
      created: false,
      review: { number: 1 },
    });
    expect(state.plans[0]?.existing?.number).toBe(1);
    expect(host.calls).not.toContain("createReview feature/docs main");
  });

  it("neither reopens nor duplicates a closed or merged review", async () => {
    for (const state of ["closed", "merged"] as const) {
      const host = new MockReviewHost();
      host.add("feature/docs", "main", state);
      const { ports: p, log } = ports(host);
      expect(await submit(facts(), p)).toMatchObject({
        kind: "closed-review",
        review: { state },
      });
      expect(log).toEqual(["fetch origin main"]);
      expect(host.reviews).toHaveLength(1);
    }
  });

  it("keeps commits after a failed push and retries without a duplicate", async () => {
    const host = new MockReviewHost();
    const { ports: p, state } = ports(host);
    state.pushFailure = new PushError("network");
    expect(await submit(facts(), p)).toMatchObject({ kind: "push-failed", failure: "network" });
    expect(host.reviews).toEqual([]);

    expect(await submit(facts(), p)).toMatchObject({ kind: "submitted", created: true });
    expect(await submit(facts(), p)).toMatchObject({ kind: "submitted", created: false });
    expect(host.reviews).toHaveLength(1);
  });

  it("retries after a failed review creation without a duplicate", async () => {
    const host = new MockReviewHost();
    host.failures.createReview = new HostError("unexpected", "server error");
    const { ports: p } = ports(host);
    expect(await submit(facts(), p)).toMatchObject({ kind: "host-failed", pushed: true });
    expect(await submit(facts(), p)).toMatchObject({ kind: "submitted", created: true });
    expect(host.reviews).toHaveLength(1);
  });

  it("reuses a review created concurrently instead of failing", async () => {
    const host = new MockReviewHost();
    host.createConcurrently = true;
    const { ports: p } = ports(host);
    expect(await submit(facts(), p)).toMatchObject({ kind: "submitted", created: false });
    expect(host.reviews).toHaveLength(1);
  });

  it("reports divergence, authentication failures, and fetch failures without fallback", async () => {
    const host = new MockReviewHost();
    const diverged = ports(host);
    diverged.state.pushFailure = new PushError("rejected", "non-fast-forward");
    expect(await submit(facts(), diverged.ports)).toMatchObject({
      kind: "push-failed",
      failure: "rejected",
    });
    expect(diverged.log.filter((entry) => entry.startsWith("push"))).toHaveLength(1);

    host.failures.repository = new HostError("auth", "Bad credentials");
    expect(await submit(facts(), ports(host).ports)).toMatchObject({
      kind: "host-failed",
      error: { kind: "auth" },
      pushed: false,
    });

    const fetch = ports(host);
    fetch.state.fetchFailure = new PushError("auth");
    expect(await submit(facts(), fetch.ports)).toMatchObject({
      kind: "fetch-failed",
      failure: "auth",
    });
    expect(host.reviews).toEqual([]);
  });

  it("does nothing remote when the author cancels the confirmation", async () => {
    const host = new MockReviewHost();
    const { ports: p, log, state } = ports(host);
    state.answer = undefined;
    expect(await submit(facts(), p)).toEqual({ kind: "cancelled" });
    expect(log).toEqual(["fetch origin main"]);
    expect(host.reviews).toEqual([]);
  });

  it("chooses the upstream remote, then origin, then asks", async () => {
    const host = new MockReviewHost();
    const remotes = [
      { name: "fork", url: "https://github.com/me/repo.git" },
      { name: "upstream", url: "https://github.com/owner/repo.git" },
    ];
    const asked = ports(host);
    await submit(facts({ remotes, upstreamRemote: undefined }), asked.ports);
    expect(asked.log).toContain("push upstream feature/docs -u");

    const tracked = ports(host);
    await submit(facts({ remotes, upstreamRemote: "fork" }), tracked.ports);
    expect(tracked.log).toContain("push fork feature/docs");
  });

  it("uses a single commit's subject as the default title and lists commits in the body", async () => {
    const host = new MockReviewHost();
    const { ports: p, state } = ports(host);
    state.commits = [{ id: "d".repeat(40), subject: "docs: one page" }];
    await submit(facts(), p);
    const plan = state.plans[0];
    expect(plan?.defaultTitle).toBe("docs: one page");
    expect(plan && reviewBody(plan)).toBe(
      "- docs: one page (ddddddd)\n\nSubmitted with Lorequill.\n",
    );
  });
});

describe("remote URLs", () => {
  it.each([
    ["https://github.com/owner/repo.git", "github.com", "owner", "repo"],
    ["https://user@github.com/owner/repo", "github.com", "owner", "repo"],
    ["git@github.com:owner/repo.git", "github.com", "owner", "repo"],
    ["ssh://git@github.com:22/owner/repo.git", "github.com", "owner", "repo"],
    ["https://GitHub.com/Owner/Re.po/", "github.com", "Owner", "Re.po"],
  ])("reads %s", (url, host, owner, repo) => {
    expect(parseRemoteUrl(url)).toEqual({ host, owner, repo });
  });

  it.each([
    "/srv/git/repo.git",
    "C:\\repos\\repo",
    "file:///srv/git/repo.git",
    "https://github.com/owner/repo/extra",
    "https://github.com/owner",
    "https://github.com/ow ner/repo",
  ])("rejects %s", (url) => {
    expect(parseRemoteUrl(url)).toBeUndefined();
  });

  it("targets github.com and only the configured Enterprise server", () => {
    expect(gitHubTargetFor("git@github.com:o/r.git")).toMatchObject({
      apiBase: "https://api.github.com",
      authProvider: "github",
    });
    expect(gitHubTargetFor("https://git.corp.example/o/r.git", "https://git.corp.example")).toEqual(
      {
        host: "git.corp.example",
        owner: "o",
        repo: "r",
        apiBase: "https://git.corp.example/api/v3",
        webOrigin: "https://git.corp.example",
        authProvider: "github-enterprise",
      },
    );
    expect(gitHubTargetFor("https://git.corp.example/o/r.git")).toBeUndefined();
    expect(
      gitHubTargetFor("https://gitlab.com/o/r.git", "https://git.corp.example"),
    ).toBeUndefined();
  });
});

describe("GitHubHost", () => {
  const found = gitHubTargetFor("https://github.com/owner/repo.git");
  if (!found) {
    throw new Error("target");
  }
  const target: GitHubTarget = found;

  function host(responses: Response[]) {
    const requests: { url: string; init: RequestInit }[] = [];
    const github = new GitHubHost(
      target,
      () => Promise.resolve("secret-token"),
      (url, init) => {
        requests.push({ url, init });
        const response = responses.shift();
        return response ? Promise.resolve(response) : Promise.reject(new TypeError("offline"));
      },
    );
    return { github, requests };
  }
  const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
    new Response(JSON.stringify(body), { status, headers });

  it("finds reviews by head and base, and tells merged from closed", async () => {
    const { github, requests } = host([
      json(200, [
        {
          number: 3,
          html_url: "https://github.com/owner/repo/pull/3",
          state: "closed",
          merged_at: "2026-11-01T00:00:00Z",
          title: "Old",
        },
        {
          number: 4,
          html_url: "https://github.com/owner/repo/pull/4",
          state: "closed",
          merged_at: null,
          title: "Closed",
        },
      ]),
    ]);
    expect((await github.findReviews("feature/docs", "main")).map(({ state }) => state)).toEqual([
      "merged",
      "closed",
    ]);
    expect(requests[0]?.url).toBe(
      "https://api.github.com/repos/owner/repo/pulls?state=all&head=owner%3Afeature%2Fdocs&base=main&per_page=100",
    );
    expect(new Headers(requests[0]?.init.headers).get("authorization")).toBe("Bearer secret-token");
    expect(requests[0]?.init.redirect).toBe("error");
  });

  it("creates a review and reads repository permissions", async () => {
    const { github, requests } = host([
      json(200, { default_branch: "main", permissions: { push: true } }),
      json(201, {
        number: 7,
        html_url: "https://github.com/owner/repo/pull/7",
        state: "open",
        title: "Docs",
      }),
    ]);
    expect(await github.repository()).toEqual({ defaultBranch: "main", canPush: true });
    expect(
      await github.createReview({ branch: "feature/docs", base: "main", title: "Docs", body: "b" }),
    ).toEqual({
      number: 7,
      url: "https://github.com/owner/repo/pull/7",
      state: "open",
      title: "Docs",
    });
    expect(requests[1]?.init.method).toBe("POST");
    expect(JSON.parse(requests[1]?.init.body as string)).toEqual({
      title: "Docs",
      head: "feature/docs",
      base: "main",
      body: "b",
    });
  });

  it("maps errors to host error kinds", async () => {
    const cases: [Response, string][] = [
      [json(401, { message: "Bad credentials" }), "auth"],
      [json(403, { message: "Forbidden" }), "forbidden"],
      [json(403, { message: "x" }, { "x-ratelimit-remaining": "0" }), "rate-limited"],
      [json(404, { message: "Not Found" }), "not-found"],
      [
        json(422, {
          message: "Validation Failed",
          errors: [{ message: "A pull request already exists for owner:feature/docs." }],
        }),
        "already-exists",
      ],
      [
        json(422, { message: "Validation Failed", errors: [{ message: "No commits between" }] }),
        "invalid",
      ],
      [json(500, {}), "unexpected"],
    ];
    for (const [response, kind] of cases) {
      await expect(host([response]).github.repository()).rejects.toMatchObject({ kind });
    }
    await expect(host([]).github.repository()).rejects.toMatchObject({ kind: "network" });
  });

  it("rejects answers that do not match the API, including foreign review URLs", async () => {
    const { github } = host([
      json(200, [
        { number: 1, html_url: "https://evil.example/pull/1", state: "open", title: "x" },
      ]),
    ]);
    await expect(github.findReviews("b", "main")).rejects.toMatchObject({ kind: "unexpected" });
  });
});
