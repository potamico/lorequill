import * as assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { rm, writeFile } from "node:fs/promises";
import * as path from "node:path";
import * as vscode from "vscode";
import {
  activateExtension,
  waitFor,
  waitForAsync,
  type GitProbe,
  type InternalApi,
} from "../support";

function folderPath(name: string): string {
  const folder = vscode.workspace.workspaceFolders?.find((candidate) => candidate.name === name);
  assert.ok(folder, `workspace folder ${name} is open`);
  return realpathSync(folder.uri.fsPath);
}

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

async function stagedTexts(probe: GitProbe, folder: string): Promise<Record<string, unknown>> {
  const staged = await probe.staged(folder);
  if (typeof staged === "string") {
    assert.fail(`no staged snapshot of ${folder}: ${staged}`);
  }
  return staged.texts;
}

suite("Git adapter with staged-tree snapshots", () => {
  let api: InternalApi;
  let site: string;
  let outer: string;

  suiteSetup(async () => {
    api = await activateExtension();
    site = folderPath("site");
    outer = folderPath("outer");
    await waitFor(
      "both folders to load",
      () => api.pagesTree().map((node) => node.children.length),
      (counts) => counts.length === 2 && counts.every((count) => count > 0),
    );
  });

  test("binds each content root to the innermost repository that contains it", async () => {
    // Git reports the root in its own spelling; on Windows the drive letter case can differ.
    const sameRoot = (
      binding: Awaited<ReturnType<InternalApi["git"]["binding"]>>,
      root: string,
    ): void => {
      assert.ok(typeof binding !== "string", binding as string);
      assert.equal(path.relative(binding.root, root), "", `${binding.root} is ${root}`);
      assert.equal(binding.prefix, "docs");
    };
    sameRoot(await api.git.binding("site"), site);
    sameRoot(await api.git.binding("outer"), path.join(outer, "inner"));
  });

  test("reports branch, remotes, and repository problems per folder", async () => {
    const siteStatus = await api.git.status("site");
    assert.ok(typeof siteStatus !== "string");
    assert.equal(siteStatus.head.kind === "branch" && siteStatus.head.branch, "feature/docs");
    assert.deepEqual(siteStatus.remotes, ["origin"]);
    assert.deepEqual(siteStatus.problems, []);

    const outerStatus = await api.git.status("outer");
    assert.ok(typeof outerStatus !== "string");
    assert.deepEqual(outerStatus.problems, ["no-remote"]);
  });

  test("keeps folders apart: each snapshot holds only its own content root", async () => {
    assert.deepEqual(Object.keys(await stagedTexts(api.git, "site")), ["a.md", "b.md"]);
    assert.deepEqual(await stagedTexts(api.git, "outer"), { "inner.md": "# Inner\n" });
  });

  test("excludes unstaged changes and unsaved buffers from the staged snapshot", async () => {
    const document = await vscode.workspace.openTextDocument(path.join(site, "docs", "a.md"));
    const edit = new vscode.WorkspaceEdit();
    edit.insert(document.uri, new vscode.Position(1, 0), "Unsaved\n");
    assert.ok(await vscode.workspace.applyEdit(edit));
    assert.ok(document.isDirty);
    await writeFile(path.join(site, "docs", "b.md"), "# B, unstaged\n");

    try {
      assert.deepEqual(await stagedTexts(api.git, "site"), { "a.md": "# A\n", "b.md": "# B\n" });
    } finally {
      await vscode.commands.executeCommand("workbench.action.files.revert", document.uri);
    }
  });

  test("stages and unstages whole files through the Git extension", async () => {
    const page = path.join(site, "docs", "b.md");
    await writeFile(page, "# B, staged\n");
    const before = await api.git.staged("site");

    assert.equal(await api.git.stage("site", [page]), true);
    assert.equal((await stagedTexts(api.git, "site"))["b.md"], "# B, staged\n");
    await waitForAsync(
      "the Git extension to list the staged file",
      async () => {
        const status = await api.git.status("site");
        return typeof status === "string" ? [] : status.staged;
      },
      (staged) => staged.some((file) => realpathSync(file) === page),
    );

    assert.equal(await api.git.unstage("site", [page]), true);
    const after = await api.git.staged("site");
    assert.ok(typeof before !== "string" && typeof after !== "string");
    assert.equal(after.tree, before.tree);
    assert.equal(after.texts["b.md"], "# B\n");
  });

  test("validates a staged deletion in the staged tree", async () => {
    const page = path.join(site, "docs", "b.md");
    await rm(page);
    try {
      assert.ok("b.md" in (await stagedTexts(api.git, "site")), "unstaged deletion is ignored");
      assert.equal(await api.git.stage("site", [page]), true);
      assert.deepEqual(Object.keys(await stagedTexts(api.git, "site")), ["a.md"]);
    } finally {
      git(site, "reset", "-q", "--", "docs/b.md");
      git(site, "checkout", "--", "docs/b.md");
    }
  });

  test("refuses to stage anything outside the folder's repository", async () => {
    assert.equal(await api.git.stage("site", [path.join(outer, "README.md")]), false);
    assert.equal(await api.git.stage("outer", [path.join(outer, "README.md")]), false);
    assert.equal(await api.git.stage("site", [path.join(site, "..", "outside.md")]), false);
  });

  test("detects a checkout made outside VS Code", async () => {
    const before = api.git.headChanges.length;
    git(site, "checkout", "-q", "-b", "elsewhere");
    try {
      await waitFor(
        "the HEAD change",
        () => api.git.headChanges.slice(before),
        (changes) =>
          changes.some(
            ({ current }) => current.kind === "branch" && current.branch === "elsewhere",
          ),
        20_000,
      );
    } finally {
      git(site, "checkout", "-q", "feature/docs");
    }
  });
});
