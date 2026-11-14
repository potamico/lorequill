import * as assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import * as vscode from "vscode";
import { activateExtension, waitFor, type InternalApi, type MockHost } from "../support";

function git(cwd: string, ...args: string[]): string {
  const env: NodeJS.ProcessEnv = {};
  for (const [name, value] of Object.entries(process.env)) {
    if (!name.startsWith("GIT_")) {
      env[name] = value;
    }
  }
  return execFileSync("git", args, {
    cwd,
    env: {
      ...env,
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_AUTHOR_NAME: "Lorequill Test",
      GIT_AUTHOR_EMAIL: "test@example.invalid",
      GIT_COMMITTER_NAME: "Lorequill Test",
      GIT_COMMITTER_EMAIL: "test@example.invalid",
    },
    encoding: "utf8",
  }).trim();
}

suite("Submit for review", () => {
  let api: InternalApi;
  let host: MockHost;
  let site: string;
  let remote: string;
  let initial: string;

  /** Commits page changes on a new branch from the initial commit. */
  async function branchWithCommits(branch: string, count: number): Promise<void> {
    git(site, "checkout", "-q", "-b", branch, initial);
    for (let index = 1; index <= count; index++) {
      await writeFile(
        path.join(site, "docs", `${branch.replace(/\W/g, "-")}-${String(index)}.md`),
        `# Page ${String(index)}\n`,
      );
      git(site, "add", "docs");
      git(site, "commit", "-q", "-m", `docs: page ${String(index)} on ${branch}`);
    }
  }

  const remoteHas = (branch: string): string | undefined => {
    try {
      return git(remote, "rev-parse", "--verify", "-q", `refs/heads/${branch}`);
    } catch {
      return undefined;
    }
  };

  suiteSetup(async () => {
    api = await activateExtension();
    const folder = vscode.workspace.workspaceFolders?.find(({ name }) => name === "site");
    assert.ok(folder);
    site = realpathSync(folder.uri.fsPath);
    remote = path.join(path.dirname(site), "remote.git");
    initial = git(site, "rev-parse", "feature/docs");
    await waitFor(
      "both folders to load",
      () => api.pagesTree().map((node) => node.children.length),
      (counts) => counts.length === 2 && counts.every((count) => count > 0),
    );
  });

  setup(() => {
    host = api.useMockHost();
  });

  teardown(async () => {
    await rm(path.join(site, ".git", "hooks", "pre-commit"), { force: true });
    git(site, "checkout", "-q", "-f", "feature/docs");
    git(site, "reset", "-q", "--hard", initial);
    git(site, "clean", "-q", "-fd", "--", "docs");
  });

  test("submits one review with several page commits, and a retry reuses it", async () => {
    await branchWithCommits("submit/two", 2);
    const outcome = await api.submit({ folder: "site", confirm: true, title: "Two pages" });
    assert.equal(outcome?.kind, "submitted");
    assert.equal(outcome.created, true);
    assert.equal(remoteHas("submit/two"), git(site, "rev-parse", "HEAD"));
    assert.deepEqual(
      host.reviews.map(({ title, branch, base }) => [title, branch, base]),
      [["Two pages", "submit/two", "main"]],
    );

    const review = await api.review("site");
    assert.match(review.status.text, /PR #1/);
    assert.equal(review.status.command, "lorequill.openReview");

    const again = await api.submit({ folder: "site", confirm: true });
    assert.equal(again?.kind, "submitted");
    assert.equal(again.created, false);
    assert.equal(host.reviews.length, 1);
  });

  test("moves commits on the base branch to a new branch with consent, else pushes nothing", async () => {
    git(site, "checkout", "-q", "main");
    const before = git(site, "rev-parse", "main");
    await writeFile(path.join(site, "docs", "on-main.md"), "# On main\n");
    git(site, "add", "docs");
    git(site, "commit", "-q", "-m", "docs: page on main");
    const head = git(site, "rev-parse", "HEAD");

    assert.deepEqual(await api.submit({ folder: "site", confirm: true }), { kind: "cancelled" });
    assert.equal(git(site, "branch", "--show-current"), "main");

    const outcome = await api.submit({ folder: "site", confirm: true, branch: "page-on-main" });
    assert.equal(outcome?.kind, "submitted");
    assert.equal(git(site, "branch", "--show-current"), "page-on-main");
    assert.equal(remoteHas("page-on-main"), head);
    assert.equal(remoteHas("main"), before, "the base branch on the remote is unchanged");
    assert.equal(git(site, "rev-parse", "main"), before, "local main follows the remote again");
    assert.deepEqual(
      host.reviews.map(({ title, branch, base }) => [title, branch, base]),
      [["docs: page on main", "page-on-main", "main"]],
    );
    git(site, "checkout", "-q", "-f", "main");
    git(site, "reset", "-q", "--hard", before);
    git(site, "branch", "-q", "-D", "page-on-main");
    git(remote, "branch", "-q", "-D", "page-on-main");
  });

  test("blocks a detached HEAD without pushing", async () => {
    git(site, "checkout", "-q", "--detach", initial);
    assert.equal((await api.submit({ folder: "site", confirm: true }))?.kind, "blocked");
    assert.deepEqual(host.calls, []);
  });

  test("neither reopens nor duplicates a merged review and pushes nothing", async () => {
    await branchWithCommits("submit/merged", 1);
    host.add("submit/merged", "main", "merged");
    const outcome = await api.submit({ folder: "site", confirm: true });
    assert.equal(outcome?.kind, "closed-review");
    assert.equal(remoteHas("submit/merged"), undefined);
    assert.equal(host.reviews.length, 1);
  });

  test("keeps commits after a failed review creation and retries without a duplicate", async () => {
    await branchWithCommits("submit/retry", 1);
    host.failNextCreate();
    const failed = await api.submit({ folder: "site", confirm: true });
    assert.equal(failed?.kind, "host-failed");
    assert.ok(remoteHas("submit/retry"), "the branch was pushed");
    assert.equal(host.reviews.length, 0);

    const retried = await api.submit({ folder: "site", confirm: true });
    assert.equal(retried?.kind, "submitted");
    assert.equal(retried.created, true);
    assert.equal(host.reviews.length, 1);
  });

  test("reports a diverged remote branch and never force-pushes", async () => {
    await branchWithCommits("submit/diverged", 1);
    assert.equal((await api.submit({ folder: "site", confirm: true }))?.kind, "submitted");

    // Someone else pushes to the same branch.
    const other = await mkdtemp(path.join(tmpdir(), "lq-clone-"));
    try {
      git(other, "clone", "-q", "--branch", "submit/diverged", remote, ".");
      await writeFile(path.join(other, "docs", "theirs.md"), "# Theirs\n");
      git(other, "add", "docs");
      git(other, "commit", "-q", "-m", "their change");
      git(other, "push", "-q", "origin", "submit/diverged");
    } finally {
      await rm(other, { recursive: true, force: true });
    }
    const theirs = remoteHas("submit/diverged");

    await writeFile(path.join(site, "docs", "mine.md"), "# Mine\n");
    git(site, "add", "docs");
    git(site, "commit", "-q", "-m", "my change");
    const mine = git(site, "rev-parse", "HEAD");
    const outcome = await api.submit({ folder: "site", confirm: true });
    assert.equal(outcome?.kind, "push-failed");
    assert.equal(outcome.failure, "rejected");
    assert.equal(remoteHas("submit/diverged"), theirs, "the remote branch is unchanged");
    assert.equal(git(site, "rev-parse", "HEAD"), mine, "the local commit is kept");
  });

  test("blocks Submit while the last commit is not verified", async () => {
    git(site, "checkout", "-q", "-b", "submit/unverified", initial);
    await writeFile(
      path.join(site, ".git", "hooks", "pre-commit"),
      '#!/bin/sh\necho "# From a hook" > docs/hook.md\ngit add docs/hook.md\n',
      { mode: 0o755 },
    );
    await writeFile(path.join(site, "docs", "a.md"), "# A, unverified\n");
    assert.equal(
      await api.commit({ folder: "site", select: ["docs/a.md"], message: "m" }),
      "unverified",
    );
    assert.deepEqual(await api.submit({ folder: "site", confirm: true }), {
      kind: "blocked",
      reason: "unverified",
    });
    assert.equal(remoteHas("submit/unverified"), undefined);

    assert.equal(await api.verifyCommit("site"), "verified");
    assert.equal((await api.submit({ folder: "site", confirm: true }))?.kind, "submitted");
  });
});
