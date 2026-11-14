import * as assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import * as path from "node:path";
import * as vscode from "vscode";
import {
  activateExtension,
  waitFor,
  type EditorSessionProbe,
  type InternalApi,
  WEBVIEW_TIMEOUT_MS,
} from "../support";

/*
 * The MVP acceptance scenario of specification §17, end to end in the extension host, with a
 * local bare repository as the remote and the mock review host. It also demonstrates the release
 * gate: native save semantics, a multi-page commit through the standard index, an immutable
 * staged-tree check, and safe submission.
 */

const VIEW_TYPE = "lorequill.pageEditor";
const BRANCH = "acceptance/mvp";

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

/** Webview edit inserting `text` at a position, as the page editor's webview sends it. */
function insert(id: number, baseVersion: number, line: number, character: number, text: string) {
  return {
    type: "edit",
    id,
    baseVersion,
    changes: [{ from: { line, character }, to: { line, character }, text }],
  };
}

suite("MVP acceptance scenario (§17)", () => {
  let api: InternalApi;
  let site: string;
  let remote: string;
  let initial: string;

  const file = (relative: string): vscode.Uri =>
    vscode.Uri.file(path.join(site, ...relative.split("/")));
  const read = (relative: string): Promise<string> =>
    readFile(path.join(site, ...relative.split("/")), "utf8");

  async function open(relative: string): Promise<EditorSessionProbe> {
    await vscode.commands.executeCommand("vscode.openWith", file(relative), VIEW_TYPE);
    const session = await waitFor(
      `the page editor for ${relative}`,
      () => api.editorSessions().find(({ uri }) => uri.fsPath === file(relative).fsPath),
      (candidate) => candidate?.sent.some(({ type }) => type === "init") === true,
      WEBVIEW_TIMEOUT_MS,
    );
    assert.ok(session);
    return session;
  }

  function document(relative: string): vscode.TextDocument {
    const found = vscode.workspace.textDocuments.find(
      ({ uri }) => uri.fsPath === file(relative).fsPath,
    );
    assert.ok(found, `${relative} is open`);
    return found;
  }

  async function checkSite(): Promise<{ status: string; findings: number }> {
    const result = await api.checkPages();
    const summary = result?.folders.find(
      ({ folderUri }) => vscode.Uri.parse(folderUri).fsPath === vscode.Uri.file(site).fsPath,
    );
    assert.ok(summary, "Check Pages checked the site folder");
    return summary;
  }

  suiteSetup(async () => {
    api = await activateExtension();
    const folder = vscode.workspace.workspaceFolders?.find(({ name }) => name === "site");
    assert.ok(folder);
    site = realpathSync(folder.uri.fsPath);
    remote = path.join(path.dirname(site), "remote.git");
    initial = git(site, "rev-parse", "feature/docs");
    await waitFor(
      "the Pages tree",
      () => api.pagesTree().find(({ label }) => label === "site")?.children.length ?? 0,
      (count) => count >= 2,
    );
  });

  suiteTeardown(async () => {
    await vscode.commands.executeCommand("workbench.action.revertAndCloseActiveEditor");
    await vscode.commands.executeCommand("workbench.action.closeAllEditors");
    git(site, "checkout", "-q", "-f", "feature/docs");
    git(site, "reset", "-q", "--hard", initial);
    git(site, "clean", "-q", "-fd", "--", "docs");
    for (const repository of [site, remote]) {
      try {
        git(repository, "branch", "-q", "-D", BRANCH);
      } catch {
        // The test stopped before the branch existed there.
      }
    }
  });

  test("an author edits, checks, commits, and submits two pages", async () => {
    // A feature branch with a page that has front matter, and unrelated work in progress.
    git(site, "checkout", "-q", "-b", BRANCH, initial);
    await writeFile(
      path.join(site, "docs", "a.md"),
      "---\ntitle: A\nstatus: draft\n---\n# A\n\nIntro of A.\n",
    );
    git(site, "add", "docs/a.md");
    git(site, "commit", "-q", "-m", "docs: front matter for A");
    const start = git(site, "rev-parse", "HEAD");
    await writeFile(path.join(site, "README.md"), "# Site\n\nWork in progress.\n");
    const host = api.useMockHost();

    // The Pages tree shows the pages; the author opens two pages in the Lorequill editor.
    await waitFor(
      "page A in the Pages tree",
      () => api.pagesTree().find(({ label }) => label === "site")?.children ?? [],
      (children) => children.some(({ label }) => label === "A"),
    );
    const a = await open("docs/a.md");
    const b = await open("docs/b.md");

    // Body edits in both pages, a property change in one, and a relative link inserted with
    // the path that Insert Link and link completion produce.
    await b.receive(insert(1, document("docs/b.md").version, 1, 0, "\nBody of B.\n"));
    await a.receive({ type: "complete", id: 2 });
    const completions = await waitFor(
      "link completions",
      () => a.sent.find((message) => message.type === "completions" && message.id === 2),
      (message) => message !== undefined,
    );
    const items = (completions as unknown as { items: { label: string }[] }).items;
    assert.ok(items.some(({ label }) => label === "b.md"));
    const docA = document("docs/a.md");
    await a.receive(insert(3, docA.version, 7, 0, "\nSee [B](b.md) and [C](c.md).\n"));
    await vscode.commands.executeCommand("vscode.openWith", file("docs/a.md"), VIEW_TYPE);
    await vscode.commands.executeCommand("lorequill.properties.focus");
    api.properties.refresh();
    await api.properties.idle();
    await waitFor(
      "the properties of A",
      () => api.properties.lastModel?.page,
      (page) => page === "a.md",
    );
    assert.equal(
      await api.properties.applyRequest({ type: "set", key: "status", value: "review" }),
      true,
    );

    // Native save writes both pages; nothing is committed and the branch does not change.
    await vscode.commands.executeCommand("workbench.action.files.saveAll");
    await waitFor(
      "both pages saved",
      () => docA.isDirty || document("docs/b.md").isDirty,
      (dirty) => !dirty,
    );
    assert.equal(git(site, "rev-parse", "HEAD"), start);
    assert.equal(git(site, "branch", "--show-current"), BRANCH);
    assert.match(await read("docs/a.md"), /status: review/);

    // Check Pages finds the broken link; the author fixes it and checks again.
    const first = await checkSite();
    assert.equal(first.status, "failed");
    assert.equal(first.findings, 1);
    const line = docA
      .getText()
      .split("\n")
      .findIndex((text) => text.includes("[C](c.md)"));
    const fix = new vscode.WorkspaceEdit();
    fix.replace(
      docA.uri,
      new vscode.Range(line, 0, line, docA.lineAt(line).text.length),
      "See [B](b.md).",
    );
    assert.ok(await vscode.workspace.applyEdit(fix));
    // The check reads the unsaved buffer (AT 42).
    assert.equal((await checkSite()).status, "passed");
    await vscode.commands.executeCommand("workbench.action.files.saveAll");

    // Commit: both pages in one commit, with the commit check on the staged tree. The
    // unrelated README change stays unstaged and untouched.
    assert.equal(
      await api.commit({
        folder: "site",
        select: ["docs/a.md", "docs/b.md"],
        message: "docs: edit A and B",
      }),
      "committed",
    );
    assert.equal(git(site, "branch", "--show-current"), BRANCH);
    assert.equal(git(site, "rev-parse", "HEAD~1"), start);
    assert.deepEqual(
      git(site, "diff-tree", "--no-commit-id", "--name-only", "-r", "HEAD").split("\n"),
      ["docs/a.md", "docs/b.md"],
    );
    assert.equal(git(site, "log", "-1", "--format=%s|%an"), "docs: edit A and B|Lorequill Test");
    assert.equal(git(site, "status", "--porcelain", "--", "README.md"), "M README.md");
    assert.equal(await read("README.md"), "# Site\n\nWork in progress.\n");

    // No content outside the intentional edits changed.
    assert.equal(
      git(site, "show", "HEAD:docs/a.md"),
      "---\ntitle: A\nstatus: review\n---\n# A\n\nIntro of A.\n\nSee [B](b.md).",
    );
    assert.equal(git(site, "show", "HEAD:docs/b.md"), "# B\n\nBody of B.");

    // Submit for Review: push and one pull request with every commit of the branch.
    const outcome = await api.submit({ folder: "site", confirm: true, title: "Edit A and B" });
    assert.equal(outcome?.kind, "submitted");
    assert.equal(git(remote, "rev-parse", `refs/heads/${BRANCH}`), git(site, "rev-parse", "HEAD"));
    assert.deepEqual(
      host.reviews.map(({ branch, base, title, state }) => [branch, base, title, state]),
      [[BRANCH, "main", "Edit A and B", "open"]],
    );
    assert.equal(git(site, "rev-list", "--count", `main..${BRANCH}`), "2");

    // CI runs the pinned engine on the submitted state and reports no findings.
    const bundle = path.resolve(__dirname, "../../../../../../../action/dist/index.cjs");
    const output = execFileSync("node", [bundle], {
      env: { PATH: process.env.PATH, GITHUB_WORKSPACE: site, INPUT_PATH: "." },
      encoding: "utf8",
    });
    assert.match(output, /^Lorequill checks engine \d+\.\d+\.\d+/);
    assert.match(output, /0 findings, passed/);
  });
});
