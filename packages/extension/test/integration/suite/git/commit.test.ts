import * as assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { rm, writeFile } from "node:fs/promises";
import * as path from "node:path";
import * as vscode from "vscode";
import { activateExtension, waitFor, type InternalApi } from "../support";

/** Runs Git outside VS Code, as another tool or a terminal would. */
function git(cwd: string, ...args: string[]): string {
  const env: NodeJS.ProcessEnv = {};
  for (const [name, value] of Object.entries(process.env)) {
    if (!name.startsWith("GIT_")) {
      env[name] = value;
    }
  }
  return execFileSync("git", args, {
    cwd,
    env: { ...env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" },
    encoding: "utf8",
  }).trim();
}

suite("Commit with commit check", () => {
  let api: InternalApi;
  let site: string;
  let initial: string;

  const commitCount = (): number => Number(git(site, "rev-list", "--count", "HEAD"));
  const write = (relative: string, text: string): Promise<void> =>
    writeFile(path.join(site, ...relative.split("/")), text);

  suiteSetup(async () => {
    api = await activateExtension();
    const folder = vscode.workspace.workspaceFolders?.find(({ name }) => name === "site");
    assert.ok(folder);
    site = realpathSync(folder.uri.fsPath);
    initial = git(site, "rev-parse", "HEAD");
    await waitFor(
      "both folders to load",
      () => api.pagesTree().map((node) => node.children.length),
      (counts) => counts.length === 2 && counts.every((count) => count > 0),
    );
  });

  teardown(async () => {
    // Every test starts from the initial commit on the feature branch with a clean work tree,
    // and the suite leaves the repository as the Git adapter tests expect it.
    await rm(path.join(site, ".git", "hooks", "pre-commit"), { force: true });
    git(site, "checkout", "-q", "-f", "feature/docs");
    git(site, "reset", "-q", "--hard", initial);
    git(site, "clean", "-q", "-fd", "--", "docs");
  });

  test("offers no commit when nothing changed or nothing is selected", async () => {
    assert.equal(await api.commit({ folder: "site" }), "nothing-to-commit");
    await write("docs/a.md", "# A, edited\n");
    assert.equal(await api.commit({ folder: "site", select: [] }), "nothing-to-commit");
  });

  test("commits two pages together and a second commit stays on the branch", async () => {
    const before = commitCount();
    await write("docs/a.md", "# A, edited\n");
    await write("docs/b.md", "# B, edited\n");
    await write("docs/unrelated.md", "# Not selected\n");

    assert.equal(
      await api.commit({
        folder: "site",
        select: ["docs/a.md", "docs/b.md"],
        message: "docs: two pages",
      }),
      "committed",
    );
    assert.equal(commitCount(), before + 1);
    assert.equal(git(site, "log", "-1", "--format=%s|%an"), "docs: two pages|Lorequill Test");
    assert.deepEqual(git(site, "show", "--name-only", "--format=", "HEAD").split("\n"), [
      "docs/a.md",
      "docs/b.md",
    ]);
    assert.equal(git(site, "status", "--porcelain"), "?? docs/unrelated.md");

    await write("docs/b.md", "# B, again\n");
    assert.equal(
      await api.commit({ folder: "site", select: ["docs/b.md"], message: "docs: again" }),
      "committed",
    );
    assert.equal(commitCount(), before + 2);
    assert.equal(git(site, "rev-parse", "--abbrev-ref", "HEAD"), "feature/docs");

    const review = await api.review("site");
    assert.equal(review.state, "verified");
    assert.equal(review.blocksSubmit, false);
    assert.match(review.status.text, /Commit checked/);
  });

  test("a failing commit check blocks the commit but never Save", async () => {
    const before = commitCount();
    const document = await vscode.workspace.openTextDocument(path.join(site, "docs", "a.md"));
    const edit = new vscode.WorkspaceEdit();
    edit.insert(document.uri, new vscode.Position(1, 0), "\n[Missing](missing.md)\n");
    assert.ok(await vscode.workspace.applyEdit(edit));
    assert.ok(await document.save(), "Save works despite the broken link");

    assert.equal(
      await api.commit({ folder: "site", select: ["docs/a.md"], message: "m" }),
      "check-failed",
    );
    assert.equal(commitCount(), before);
    const review = await api.review("site");
    assert.match(review.status.text, /Commit check: 1 findings/);
    assert.equal(review.status.command, "lorequill.showCommitFindings");
  });

  test("checks the staged state, not unstaged edits", async () => {
    await write("docs/a.md", "# A\n\n[Missing](missing.md)\n");
    git(site, "add", "docs/a.md");
    await write("docs/a.md", "# A, fixed but not staged\n");
    assert.equal(
      await api.commit({ folder: "site", select: ["docs/a.md"], message: "m" }),
      "check-failed",
    );
  });

  test("pre-staged unrelated files need explicit confirmation", async () => {
    const before = commitCount();
    await write("README.md", "# Site, edited\n");
    git(site, "add", "README.md");
    await write("docs/a.md", "# A, edited\n");

    const answers = { folder: "site", select: ["docs/a.md", "README.md"], message: "m" };
    assert.equal(await api.commit({ ...answers, confirm: false }), "cancelled");
    assert.equal(commitCount(), before);
    assert.equal(await api.commit({ ...answers, confirm: true }), "committed");
    assert.deepEqual(git(site, "show", "--name-only", "--format=", "HEAD").split("\n"), [
      "README.md",
      "docs/a.md",
    ]);
  });

  test("clearing a pre-staged file unstages it and keeps its change", async () => {
    await write("docs/a.md", "# A, edited\n");
    await write("docs/b.md", "# B, staged elsewhere\n");
    git(site, "add", "docs/b.md");

    assert.equal(
      await api.commit({ folder: "site", select: ["docs/a.md"], message: "m" }),
      "committed",
    );
    assert.equal(git(site, "show", "--name-only", "--format=", "HEAD"), "docs/a.md");
    assert.equal(git(site, "diff", "--name-only"), "docs/b.md", "change kept, unstaged");
    assert.equal(git(site, "diff", "--cached", "--name-only"), "");
  });

  test("validates a staged page deletion", async () => {
    await write("docs/b.md", "# B\n\n[A](a.md)\n");
    git(site, "add", "docs/b.md");
    git(site, "commit", "-q", "-m", "link to a");
    await rm(path.join(site, "docs", "a.md"));
    assert.equal(
      await api.commit({ folder: "site", select: ["docs/a.md"], message: "m" }),
      "check-failed",
    );
  });

  test("a hook that changes the tree leaves the commit unverified until checked", async () => {
    await writeFile(
      path.join(site, ".git", "hooks", "pre-commit"),
      '#!/bin/sh\necho "# From a hook" > docs/hook.md\ngit add docs/hook.md\n',
      { mode: 0o755 },
    );
    await write("docs/a.md", "# A, edited\n");

    assert.equal(
      await api.commit({ folder: "site", select: ["docs/a.md"], message: "m" }),
      "unverified",
    );
    let review = await api.review("site");
    assert.equal(review.state, "unverified");
    assert.equal(review.blocksSubmit, true);
    assert.match(review.status.text, /Commit not verified/);
    assert.equal(review.status.command, "lorequill.verifyCommit");

    assert.equal(await api.verifyCommit("site"), "verified");
    review = await api.review("site");
    assert.equal(review.state, "verified");
    assert.equal(review.blocksSubmit, false);
  });

  test("does not commit on a detached HEAD", async () => {
    git(site, "checkout", "-q", "--detach");
    await write("docs/a.md", "# A, edited\n");
    assert.equal(await api.commit({ folder: "site", select: ["docs/a.md"] }), "detached");
  });
});
