import * as assert from "node:assert/strict";
import * as vscode from "vscode";
import { activateExtension, findExtension } from "../support";

suite("Untrusted workspace", () => {
  test("is not trusted in this scenario", () => {
    assert.equal(vscode.workspace.isTrusted, false);
  });

  test("activates with limited functionality", async () => {
    const api = await activateExtension();
    assert.equal(findExtension().isActive, true);
    assert.ok(api);
  });

  test("shows no pages and processes no file content", async () => {
    const api = await activateExtension();
    // Give a wrongly started scan the time to produce something.
    await new Promise((resolve) => setTimeout(resolve, 1500));
    assert.deepEqual(api.pagesTree(), []);
    assert.equal(api.loadedFolderCount(), 0, "no profile was read and no folder was scanned");
  });

  test("keeps the workspace-dependent commands out of the way", async () => {
    // The commands exist, but they must not read anything while the workspace is untrusted.
    const api = await activateExtension();
    await vscode.commands.executeCommand("lorequill.refreshPages");
    api.setPageFilter("welcome");
    await new Promise((resolve) => setTimeout(resolve, 500));
    assert.deepEqual(api.pagesTree(), []);
    assert.equal(api.loadedFolderCount(), 0);
  });

  test("does not start the language server and offers no checks", async () => {
    const api = await activateExtension();
    await new Promise((resolve) => setTimeout(resolve, 500));
    assert.equal(api.languageServerRunning(), false);
    assert.equal(await api.checkPages(), undefined);
    await vscode.commands.executeCommand("lorequill.checkPages");
    assert.equal(api.languageServerRunning(), false);
  });

  test("shows a notice instead of the page editor", async () => {
    const api = await activateExtension();
    const folder = vscode.workspace.workspaceFolders?.[0];
    assert.ok(folder);
    const page = vscode.Uri.joinPath(folder.uri, "docs", "welcome.md");
    await vscode.commands.executeCommand("vscode.openWith", page, "lorequill.pageEditor");
    await new Promise((resolve) => setTimeout(resolve, 500));
    assert.deepEqual(api.editorSessions(), [], "no editing session, no document content sent");
    await vscode.commands.executeCommand("workbench.action.closeAllEditors");
  });
});
