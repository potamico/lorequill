import { execFileSync } from "node:child_process";
import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GitBinary } from "../../src/core/git/git-process";
import { commitsSince, readHead } from "../../src/core/git/repository";
import { GitHubHost, gitHubTargetFor, type GitHubTarget } from "../../src/core/host/github";
import { PushError, submit, type SubmitPorts } from "../../src/core/host/submit";

/*
 * Acceptance test 41 against a disposable GitHub repository. Runs only when both variables are
 * set; the repository must be one you can push to and throw away:
 *
 *   LOREQUILL_E2E_GITHUB_REPO=owner/repo LOREQUILL_E2E_GITHUB_TOKEN=... npm run test:e2e:github
 *
 * The token needs the `repo` scope (or contents and pull request write access). It is passed to
 * Git through environment configuration, never through arguments or files, and never printed.
 */
const repository = process.env.LOREQUILL_E2E_GITHUB_REPO ?? "";
const token = process.env.LOREQUILL_E2E_GITHUB_TOKEN ?? "";
const enabled = /^[\w.-]+\/[\w.-]+$/.test(repository) && token !== "";

/** Git with the token as an HTTP header from environment configuration. */
function git(cwd: string, ...args: string[]): string {
  const env: NodeJS.ProcessEnv = {};
  for (const [name, value] of Object.entries(process.env)) {
    if (!name.startsWith("GIT_") && !name.startsWith("LOREQUILL_E2E")) {
      env[name] = value;
    }
  }
  const basic = Buffer.from(`x-access-token:${token}`).toString("base64");
  return execFileSync("git", args, {
    cwd,
    env: {
      ...env,
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_TERMINAL_PROMPT: "0",
      GIT_CONFIG_COUNT: "1",
      GIT_CONFIG_KEY_0: "http.https://github.com/.extraheader",
      GIT_CONFIG_VALUE_0: `AUTHORIZATION: basic ${basic}`,
    },
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

async function api(method: string, path: string, body?: unknown): Promise<unknown> {
  const response = await fetch(`https://api.github.com/repos/${repository}${path}`, {
    method,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "User-Agent": "Lorequill e2e",
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!response.ok && response.status !== 404 && response.status !== 422) {
    throw new Error(`GitHub API ${method} ${path}: ${String(response.status)}`);
  }
  return response.status === 204 ? undefined : response.json();
}

describe.skipIf(!enabled)("Submit for review against GitHub (AT 41)", () => {
  const branch = `lorequill-e2e-${String(Date.now())}`;
  let work: string;
  let target: GitHubTarget;
  let base: string;
  const created: number[] = [];

  function ports(): SubmitPorts {
    return {
      chooseRemote: () => Promise.resolve("origin"),
      hostFor: () => new GitHubHost(target, () => Promise.resolve(token)),
      fetchBase: (remote, ref) => {
        git(work, "fetch", "-q", remote, `refs/heads/${ref}:refs/remotes/${remote}/${ref}`);
        return Promise.resolve();
      },
      commitsSince: (remote, ref) => commitsSince(new GitBinary("git", work), remote, ref),
      confirm: (plan) => Promise.resolve({ title: `Lorequill e2e: ${plan.branch}` }),
      branchOff: () => Promise.resolve(undefined),
      push: (remote, name, setUpstream) => {
        try {
          git(work, "push", "-q", ...(setUpstream ? ["-u"] : []), remote, name);
          return Promise.resolve();
        } catch {
          return Promise.reject(new PushError("failed"));
        }
      },
    };
  }

  async function facts() {
    return {
      head: await readHead(new GitBinary("git", work)),
      baseBranch: base,
      reviewBlocked: false,
      conflicted: false,
      stagedChanges: false,
      remotes: [{ name: "origin", url: `https://github.com/${repository}.git` }],
      upstreamRemote:
        git(work, "for-each-ref", "--format=%(upstream:remotename)", `refs/heads/${branch}`) ||
        undefined,
    };
  }

  beforeAll(async () => {
    const found = gitHubTargetFor(`https://github.com/${repository}.git`);
    if (!found) {
      throw new Error("Not a GitHub repository name.");
    }
    target = found;
    base = (await new GitHubHost(target, () => Promise.resolve(token)).repository()).defaultBranch;
    work = await realpath(await mkdtemp(join(tmpdir(), "lq-e2e-")));
    git(work, "clone", "-q", "--branch", base, `https://github.com/${repository}.git`, ".");
    git(work, "config", "user.name", "Lorequill E2E");
    git(work, "config", "user.email", "e2e@example.invalid");
    git(work, "checkout", "-q", "-b", branch);
    for (const index of [1, 2]) {
      await writeFile(
        join(work, `lorequill-e2e-${String(index)}.md`),
        `# E2E page ${String(index)}\n`,
      );
      git(work, "add", ".");
      git(work, "commit", "-q", "-m", `docs: e2e page ${String(index)}`);
    }
  });

  afterAll(async () => {
    for (const number of created) {
      await api("PATCH", `/pulls/${String(number)}`, { state: "closed" });
    }
    await api("DELETE", `/git/refs/heads/${branch}`);
    if (work) {
      await rm(work, { recursive: true, force: true });
    }
  });

  it("creates one pull request with both commits, reuses it, and never reopens it", async () => {
    const first = await submit(await facts(), ports());
    expect(first).toMatchObject({ kind: "submitted", created: true });
    if (first.kind !== "submitted") {
      return;
    }
    created.push(first.review.number);
    expect(first.review.url).toMatch(/^https:\/\/github\.com\//);
    const commits = (await api(
      "GET",
      `/pulls/${String(first.review.number)}/commits`,
    )) as unknown[];
    expect(commits).toHaveLength(2);

    const again = await submit(await facts(), ports());
    expect(again).toMatchObject({
      kind: "submitted",
      created: false,
      review: { number: first.review.number },
    });

    await api("PATCH", `/pulls/${String(first.review.number)}`, { state: "closed" });
    const afterClose = await submit(await facts(), ports());
    expect(afterClose).toMatchObject({ kind: "closed-review", review: { state: "closed" } });
    const pulls = (await api(
      "GET",
      `/pulls?state=all&head=${repository.split("/")[0] ?? ""}:${branch}`,
    )) as unknown[];
    expect(pulls).toHaveLength(1);
  });
});
