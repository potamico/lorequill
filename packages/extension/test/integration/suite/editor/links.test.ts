import * as assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import * as path from "node:path";
import * as vscode from "vscode";
import {
  activateExtension,
  waitFor,
  type EditorSessionProbe,
  type InternalApi,
  WEBVIEW_TIMEOUT_MS,
} from "../support";

const VIEW_TYPE = "lorequill.pageEditor";

function fileUri(...segments: string[]): vscode.Uri {
  const folder = vscode.workspace.workspaceFolders?.[0];
  assert.ok(folder, "a workspace folder is open");
  return vscode.Uri.file(path.join(folder.uri.fsPath, ...segments));
}

async function session(api: InternalApi, uri: vscode.Uri): Promise<EditorSessionProbe> {
  await vscode.commands.executeCommand("vscode.openWith", uri, VIEW_TYPE);
  const found = await waitFor(
    "the editor session",
    () => api.editorSessions().find((candidate) => candidate.uri.fsPath === uri.fsPath),
    (candidate) => candidate?.sent.some(({ type }) => type === "init") === true,
    WEBVIEW_TIMEOUT_MS,
  );
  assert.ok(found);
  return found;
}

async function completions(
  probe: EditorSessionProbe,
  id: number,
  anchorsOf?: string,
): Promise<{ label: string; detail?: string; keywords?: string[] }[]> {
  await probe.receive({ type: "complete", id, ...(anchorsOf === undefined ? {} : { anchorsOf }) });
  const answer = await waitFor(
    `completions ${String(id)}`,
    () => probe.sent.find((message) => message.type === "completions" && message.id === id),
    (message) => message !== undefined,
  );
  return (answer as unknown as { items: { label: string; detail?: string; keywords?: string[] }[] })
    .items;
}

suite("Pages and links", () => {
  let api: InternalApi;

  suiteSetup(async () => {
    api = await activateExtension();
    // This suite may run first: wait until the profile and the pages are loaded.
    await waitFor(
      "the pages to load",
      () => api.pagesTree().length,
      (count) => count > 0,
    );
  });

  teardown(async () => {
    await vscode.commands.executeCommand("workbench.action.closeAllEditors");
  });

  test("creates a page in the chosen directory with its collection (AT 11)", async () => {
    const uri = await api.createPage("iam/concepts", {
      title: "Rolle & Recht",
      fileName: "rolle-recht",
    });
    assert.ok(uri);
    assert.equal(uri.fsPath, fileUri("docs", "iam", "concepts", "rolle-recht.md").fsPath);
    const text = await readFile(uri.fsPath, "utf8");
    assert.match(
      text,
      /^---\ntitle: Rolle & Recht\ntype: concept\nstatus: draft\n---\n# Rolle & Recht\n$/,
    );
    await waitFor(
      "the new page to open in the Lorequill editor",
      () => api.editorSessions().some((candidate) => candidate.uri.fsPath === uri.fsPath),
      Boolean,
    );
  });

  test("creates a heading-only page without a collection and rejects collisions", async () => {
    const uri = await api.createPage("", { title: "Notizen", fileName: "notizen" });
    assert.ok(uri);
    assert.equal(await readFile(uri.fsPath, "utf8"), "# Notizen\n");
    const before = await readFile(fileUri("docs", "second.md").fsPath, "utf8");
    assert.equal(await api.createPage("", { title: "Second", fileName: "Second.md" }), undefined);
    assert.equal(await readFile(fileUri("docs", "second.md").fsPath, "utf8"), before);
    assert.equal(
      await api.createPage("", { title: "Escape", fileName: "../escape.md" }),
      undefined,
    );
  });

  test("completes pages and anchors with the paths Insert Link writes (AT 59)", async () => {
    const probe = await session(api, fileUri("docs", "links.md"));
    const pages = await completions(probe, 101);
    assert.ok(pages.some(({ label, detail }) => label === "second.md" && detail === "Second"));
    assert.deepEqual(
      pages.find(({ label }) => label === "iam/concepts/access.md")?.keywords,
      ["IAM"],
      "aliases are sent for matching",
    );
    assert.ok(!pages.some(({ label }) => label === "links.md"), "the page itself is not offered");

    const anchors = await completions(probe, 102, "outline.md");
    assert.deepEqual(
      anchors.map(({ label }) => label),
      ["guide", "install", "linux", "use"],
    );
    const own = await completions(probe, 103, "");
    assert.deepEqual(
      own.map(({ label }) => label),
      ["links"],
    );
    assert.deepEqual(await completions(probe, 104, "../outside.md"), []);
  });

  test("completes links in the text editor by path, title, and alias (AT 59)", async () => {
    const uri = fileUri("docs", "links.md");
    const document = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(document);

    // Our items carry the page title or heading as description; VS Code's own Markdown path
    // completion may add items without one.
    const ours = async (line: string): Promise<{ label: string; description: string }[]> => {
      const end = document.lineAt(document.lineCount - 1).range.end;
      const edit = new vscode.WorkspaceEdit();
      edit.insert(uri, end, `\n${line}`);
      assert.ok(await vscode.workspace.applyEdit(edit));
      try {
        const position = document.lineAt(document.lineCount - 1).range.end;
        const list = await vscode.commands.executeCommand<vscode.CompletionList>(
          "vscode.executeCompletionItemProvider",
          uri,
          position,
        );
        return list.items.flatMap(({ label }) =>
          typeof label !== "string" && label.description !== undefined
            ? [{ label: label.label, description: label.description }]
            : [],
        );
      } finally {
        await vscode.commands.executeCommand("workbench.action.files.revert", uri);
      }
    };

    // "page" occurs only in the title "CRLF page", not in any path.
    const byTitle = await ours("See [x](page");
    assert.deepEqual(byTitle, [{ label: "crlf.md", description: "CRLF page" }]);

    const byPath = await ours("[x](iam/conc");
    assert.ok(byPath.some(({ label }) => label === "iam/concepts/access.md"));
    assert.ok(!byPath.some(({ label }) => label === "second.md"));

    const anchors = await ours("[x](outline.md#ins");
    assert.deepEqual(anchors, [{ label: "install", description: "Install" }]);

    assert.deepEqual(await ours("```\n[x](sec"), [], "no completion in code");
  });
});
