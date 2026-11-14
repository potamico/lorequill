import * as assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import * as path from "node:path";
import * as vscode from "vscode";
import {
  activateExtension,
  waitFor,
  type EditorSessionProbe,
  type InternalApi,
  type TreeSnapshot,
  WEBVIEW_TIMEOUT_MS,
} from "../support";

const VIEW_TYPE = "lorequill.pageEditor";

function fileUri(...segments: string[]): vscode.Uri {
  const folder = vscode.workspace.workspaceFolders?.[0];
  assert.ok(folder, "a workspace folder is open");
  return vscode.Uri.file(path.join(folder.uri.fsPath, ...segments));
}

async function openInPageEditor(api: InternalApi, uri: vscode.Uri): Promise<EditorSessionProbe> {
  await vscode.commands.executeCommand("vscode.openWith", uri, VIEW_TYPE);
  const session = await waitFor(
    "the editor session",
    () => api.editorSessions().find((candidate) => candidate.uri.fsPath === uri.fsPath),
    (candidate) => candidate !== undefined,
  );
  assert.ok(session);
  // The real webview script loaded under the Content Security Policy and asked for the document.
  await waitFor(
    "the webview to request the document",
    () => session.sent.some(({ type }) => type === "init"),
    Boolean,
    WEBVIEW_TIMEOUT_MS,
  );
  return session;
}

/**
 * The last message sent to the webview, without diagnostics. The language server publishes
 * diagnostics on its own schedule, so they can arrive between an edit and its answer.
 */
function lastReply(session: EditorSessionProbe): EditorSessionProbe["sent"][number] | undefined {
  return session.sent.filter(({ type }) => type !== "diagnostics").at(-1);
}

function documentOf(uri: vscode.Uri): vscode.TextDocument {
  const document = vscode.workspace.textDocuments.find(
    (candidate) => candidate.uri.fsPath === uri.fsPath,
  );
  assert.ok(document, `${uri.fsPath} is open`);
  return document;
}

function edit(
  id: number,
  baseVersion: number,
  line: number,
  character: number,
  text: string,
): unknown {
  return {
    type: "edit",
    id,
    baseVersion,
    changes: [{ from: { line, character }, to: { line, character }, text }],
  };
}

suite("Page editor", () => {
  let api: InternalApi;

  suiteSetup(async () => {
    api = await activateExtension();
  });

  teardown(async () => {
    await vscode.commands.executeCommand("workbench.action.revertAndCloseActiveEditor");
    await vscode.commands.executeCommand("workbench.action.closeAllEditors");
  });

  test("is an option, not the default editor for Markdown", async () => {
    await vscode.commands.executeCommand("vscode.open", fileUri("README.md"));
    const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
    assert.ok(input instanceof vscode.TabInputText, "README.md opens in the text editor");
  });

  test("applies webview edits to the document as undoable edits", async () => {
    const uri = fileUri("docs", "lf.md");
    const session = await openInPageEditor(api, uri);
    const document = documentOf(uri);
    const before = document.getText();

    await session.receive(edit(1, document.version, 5, 10, " added"));
    assert.equal(document.getText(), before.replace("First line", "First line added"));
    assert.equal(document.isDirty, true);
    assert.deepEqual(lastReply(session), { type: "ack", id: 1, version: document.version });

    // Native undo works on the document; the webview receives the change.
    await vscode.commands.executeCommand("undo");
    await waitFor(
      "undo",
      () => document.getText(),
      (text) => text === before,
    );
    assert.equal(lastReply(session)?.type, "update");
  });

  test("rejects a stale edit instead of overwriting newer text", async () => {
    const uri = fileUri("docs", "lf.md");
    const session = await openInPageEditor(api, uri);
    const document = documentOf(uri);
    const staleVersion = document.version;

    const external = new vscode.WorkspaceEdit();
    external.insert(uri, new vscode.Position(0, 0), "<!-- external -->\n");
    assert.ok(await vscode.workspace.applyEdit(external));
    assert.deepEqual(lastReply(session)?.type, "update", "external changes are forwarded");

    const textAfterExternal = document.getText();
    await session.receive(edit(2, staleVersion, 0, 0, "stale"));
    assert.equal(document.getText(), textAfterExternal);
    assert.deepEqual(lastReply(session), { type: "reject", id: 2 });
  });

  test("ignores malformed and hostile messages", async () => {
    const uri = fileUri("docs", "lf.md");
    const session = await openInPageEditor(api, uri);
    const document = documentOf(uri);
    const text = document.getText();
    const sentBefore = session.sent.length;
    for (const message of [
      null,
      { type: "save" },
      { type: "edit", id: 3, baseVersion: document.version, changes: "x" },
      {
        type: "edit",
        id: 3,
        baseVersion: document.version,
        changes: [],
        uri: "file:///etc/passwd",
      },
      edit(3, document.version, 999, 0, "out of range"),
    ]) {
      await session.receive(message);
    }
    assert.equal(document.getText(), text);
    assert.equal(document.isDirty, false);
    assert.ok(
      session.sent.slice(sentBefore).every(({ type }) => type === "reject"),
      "nothing but rejections",
    );
  });

  test("keeps CRLF line endings and positions", async () => {
    const uri = fileUri("docs", "crlf.md");
    const session = await openInPageEditor(api, uri);
    const document = documentOf(uri);
    assert.equal(document.eol, vscode.EndOfLine.CRLF);
    await session.receive({
      type: "edit",
      id: 4,
      baseVersion: document.version,
      changes: [
        { from: { line: 2, character: 0 }, to: { line: 2, character: 5 }, text: "Second\nline" },
      ],
    });
    assert.equal(document.getText(), "# CRLF page\r\n\r\nSecond\r\nline line\r\n");
  });

  test("a reloaded webview receives every acknowledged edit (AT 45)", async () => {
    const uri = fileUri("docs", "lf.md");
    const session = await openInPageEditor(api, uri);
    const document = documentOf(uri);
    await session.receive(edit(1, document.version, 5, 10, " kept"));
    assert.deepEqual(lastReply(session), { type: "ack", id: 1, version: document.version });

    // A reloaded webview starts over and asks for the document again.
    await session.receive({ type: "ready" });
    const init = session.sent.filter(({ type }) => type === "init").at(-1);
    assert.ok(init?.type === "init");
    assert.equal(init.text, document.getText());
    assert.equal(init.version, document.version);
    assert.match(init.text, /First line kept/);
  });

  test("an external change updates a clean page and never overwrites a dirty one (AT 45)", async () => {
    const uri = fileUri("docs", "lf.md");
    const original = await readFile(uri.fsPath, "utf8");
    const session = await openInPageEditor(api, uri);
    const document = documentOf(uri);
    try {
      // Clean: the change on disk reaches the document and the webview.
      await writeFile(uri.fsPath, `${original}Changed on disk.\n`);
      await waitFor(
        "the document to reload",
        () => document.getText(),
        (text) => text.endsWith("Changed on disk.\n"),
      );
      await waitFor(
        "the webview update",
        () => lastReply(session)?.type,
        (type) => type === "update",
      );

      // Dirty: the unsaved edit stays; VS Code asks on save instead of overwriting it.
      await session.receive(edit(2, document.version, 0, 0, "Unsaved. "));
      assert.equal(document.isDirty, true);
      const dirty = document.getText();
      await writeFile(uri.fsPath, `${original}Changed again.\n`);
      await new Promise((resolve) => setTimeout(resolve, 1500));
      assert.equal(document.getText(), dirty);
    } finally {
      await vscode.commands.executeCommand("workbench.action.revertAndCloseActiveEditor");
      await writeFile(uri.fsPath, original);
    }
  });

  test("saves only through native save", async () => {
    const uri = fileUri("docs", "second.md");
    const session = await openInPageEditor(api, uri);
    const document = documentOf(uri);
    await session.receive(edit(5, document.version, 1, 0, "Saved text\n"));
    assert.equal(
      await readFile(uri.fsPath, "utf8"),
      "# Second\n",
      "nothing is written before save",
    );
    assert.ok(await document.save());
    assert.equal(await readFile(uri.fsPath, "utf8"), "# Second\nSaved text\n");
    assert.equal(document.isDirty, false);
  });

  test("keeps two modified pages open at the same time", async () => {
    const first = fileUri("docs", "lf.md");
    const second = fileUri("docs", "crlf.md");
    const firstSession = await openInPageEditor(api, first);
    await firstSession.receive(edit(6, documentOf(first).version, 0, 0, "A"));
    const secondSession = await openInPageEditor(api, second);
    await secondSession.receive(edit(7, documentOf(second).version, 0, 0, "B"));
    assert.equal(documentOf(first).isDirty, true);
    assert.equal(documentOf(second).isDirty, true);
    assert.ok(documentOf(first).getText().startsWith("A"));
    assert.ok(documentOf(second).getText().startsWith("B"));
    await vscode.commands.executeCommand("workbench.action.files.revert");
    await vscode.commands.executeCommand("workbench.action.closeActiveEditor");
    await vscode.commands.executeCommand("vscode.open", first);
    await vscode.commands.executeCommand("workbench.action.files.revert");
  });

  test("switches between the Lorequill editor and the text editor without losing edits", async () => {
    const uri = fileUri("docs", "lf.md");
    const session = await openInPageEditor(api, uri);
    await session.receive(edit(8, documentOf(uri).version, 0, 0, "Kept "));
    await vscode.commands.executeCommand("lorequill.openAsText", uri);
    const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
    assert.ok(input instanceof vscode.TabInputText);
    assert.ok(vscode.window.activeTextEditor?.document.getText().startsWith("Kept "));
    await vscode.commands.executeCommand("lorequill.openInEditor", uri);
    const reopened = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
    assert.ok(reopened instanceof vscode.TabInputCustom);
    assert.equal(reopened.viewType, VIEW_TYPE);
    await vscode.commands.executeCommand("workbench.action.files.revert");
  });

  test("sends toolbar labels in the display language", async () => {
    const session = await openInPageEditor(api, fileUri("docs", "second.md"));
    const init = session.sent.find(({ type }) => type === "init");
    assert.ok(init);
    const labels = init.labels as Record<string, string>;
    assert.equal(labels.bold, "Bold");
    assert.equal(labels.undo, "Undo");
    assert.equal(labels.viewBoth, "Both");
  });

  test("tells the preview where the page lives and switches view modes without edits", async () => {
    const uri = fileUri("docs", "second.md");
    const session = await openInPageEditor(api, uri);
    const init = session.sent.find(({ type }) => type === "init");
    const page = (init as { page?: { path: string; resourceBase: string } } | undefined)?.page;
    assert.equal(page?.path, "second.md");
    assert.ok(page.resourceBase.startsWith("https://"));
    assert.ok(page.resourceBase.endsWith("/"));

    const document = documentOf(uri);
    const version = document.version;
    for (const command of ["viewBoth", "viewPreview", "viewEdit"] as const) {
      await vscode.commands.executeCommand(`lorequill.editor.${command}`);
      assert.deepEqual(lastReply(session), { type: "command", command });
    }
    // AT 51: switching modes neither modifies the document nor adds undo steps.
    assert.equal(document.version, version);
    assert.equal(document.isDirty, false);
  });

  test("leaves the page location out for Markdown outside the content root", async () => {
    const session = await openInPageEditor(api, fileUri("README.md"));
    const init = session.sent.find(({ type }) => type === "init");
    assert.ok(init);
    assert.equal((init as { page?: unknown }).page, undefined);
  });

  test("asks the webview for collected typing before saving", async () => {
    const uri = fileUri("docs", "second.md");
    const session = await openInPageEditor(api, uri);
    const document = documentOf(uri);
    await session.receive(edit(9, document.version, 0, 0, "x"));
    const before = session.sent.length;
    await session.receive({ type: "request", action: "save" });
    await waitFor(
      "the save",
      () => document.isDirty,
      (dirty) => !dirty,
    );
    assert.ok(
      session.sent.slice(before).some(({ type }) => type === "flush"),
      "the host requested a flush before writing",
    );
  });

  test("undoes through the page editor command after flushing", async () => {
    const uri = fileUri("docs", "lf.md");
    const session = await openInPageEditor(api, uri);
    const document = documentOf(uri);
    const before = document.getText();
    await session.receive(edit(10, document.version, 0, 0, "Undo me "));
    assert.notEqual(document.getText(), before);
    await vscode.commands.executeCommand("lorequill.editor.undo");
    await waitFor(
      "undo",
      () => document.getText(),
      (text) => text === before,
    );
  });

  test("shows the headings of the active page in the outline and jumps to them", async () => {
    const uri = fileUri("docs", "outline.md");
    const session = await openInPageEditor(api, uri);
    const document = documentOf(uri);
    const labels = (nodes: readonly TreeSnapshot[]): unknown[] =>
      nodes.map((node) =>
        node.children.length > 0 ? [node.label, labels(node.children)] : node.label,
      );
    await waitFor(
      "the outline of the page",
      () => JSON.stringify(labels(api.outlineTree())),
      (text) => text === JSON.stringify([["Guide", [["Install", ["Linux"]], "Use"]]]),
    );
    assert.equal(api.outlineTree()[0]?.command, "lorequill.outline.reveal");

    // Typing a heading updates the outline.
    await session.receive(edit(20, document.version, 12, 0, "## New\n"));
    await waitFor(
      "the new heading",
      () => api.outlineTree()[0]?.children.map(({ label }) => label),
      (children) => JSON.stringify(children) === JSON.stringify(["Install", "Use", "New"]),
    );

    // Selecting a heading moves the editor's cursor to its line.
    const sent = session.sent.length;
    await vscode.commands.executeCommand("lorequill.outline.reveal", 9);
    assert.deepEqual(
      session.sent.slice(sent).find(({ type }) => type === "reveal"),
      { type: "reveal", line: 9 },
    );
    await vscode.commands.executeCommand("lorequill.outline.reveal", "9; rm -rf /");
    assert.equal(session.sent.filter(({ type }) => type === "reveal").length, 1);

    // Without an active Lorequill editor the outline is empty.
    await vscode.commands.executeCommand("workbench.action.revertAndCloseActiveEditor");
    await waitFor(
      "an empty outline",
      () => api.outlineTree().length,
      (count) => count === 0,
    );
  });

  test("opens linked pages on Ctrl+click and jumps to the linked heading", async () => {
    const session = await openInPageEditor(api, fileUri("docs", "links.md"));
    const sessionFor = (name: string): EditorSessionProbe | undefined =>
      api
        .editorSessions()
        .find((candidate) => candidate.uri.fsPath === fileUri("docs", name).fsPath);

    await session.receive({ type: "openLink", target: "second.md" });
    await waitFor("the linked page", () => sessionFor("second.md"), Boolean);

    await session.receive({ type: "openLink", target: "outline.md#install" });
    const outline = await waitFor(
      "the page with the anchor",
      () => sessionFor("outline.md"),
      Boolean,
    );
    assert.ok(outline);
    await waitFor(
      "the jump to the heading",
      () => outline.sent.find(({ type }) => type === "reveal"),
      (message) => message?.line === 7,
    );

    // Targets outside the content root, unknown schemes, and missing pages open nothing.
    const open = api.editorSessions().length;
    for (const target of ["../../outside.md", "javascript:alert(1)", "missing.md"]) {
      await session.receive({ type: "openLink", target });
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
    assert.equal(api.editorSessions().length, open);
  });

  test("ignores unknown toolbar actions", async () => {
    const uri = fileUri("docs", "lf.md");
    const session = await openInPageEditor(api, uri);
    const sent = session.sent.length;
    await session.receive({ type: "request", action: "runShell" });
    await session.receive({ type: "selection", line: -1, character: 0 });
    assert.equal(session.sent.length, sent);
  });
});
