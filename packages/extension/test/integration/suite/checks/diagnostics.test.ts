import * as assert from "node:assert/strict";
import * as path from "node:path";
import * as vscode from "vscode";
import { activateExtension, waitFor, type InternalApi } from "../support";

function pageUri(name: string): vscode.Uri {
  const folder = vscode.workspace.workspaceFolders?.[0];
  assert.ok(folder, "a workspace folder is open");
  return vscode.Uri.file(path.join(folder.uri.fsPath, "docs", name));
}

function codeOf(diagnostic: vscode.Diagnostic): string {
  const code = diagnostic.code;
  return typeof code === "object" ? String(code.value) : String(code);
}

function lorequillDiagnostics(uri: vscode.Uri): vscode.Diagnostic[] {
  return vscode.languages.getDiagnostics(uri).filter(({ source }) => source === "Lorequill");
}

suite("Checks and diagnostics", () => {
  let api: InternalApi;

  suiteSetup(async () => {
    api = await activateExtension();
    await waitFor("the language server", () => api.languageServerRunning(), Boolean);
  });

  test("shows findings of saved files as diagnostics without being asked", async () => {
    const diagnostics = await waitFor(
      "diagnostics for index.md",
      () => lorequillDiagnostics(pageUri("index.md")),
      (list) => list.length === 1,
    );
    const diagnostic = diagnostics[0];
    assert.ok(diagnostic);
    assert.equal(diagnostic.severity, vscode.DiagnosticSeverity.Error);
    assert.equal(diagnostic.code, "links");
    // The display language of the test instance is English, whatever the profile locale says.
    assert.equal(diagnostic.message, 'Link target "docs/setup.md" does not exist.');
    assert.deepEqual(
      [
        diagnostic.range.start.line,
        diagnostic.range.start.character,
        diagnostic.range.end.character,
      ],
      [2, 0, 17],
    );
    assert.deepEqual(lorequillDiagnostics(pageUri("clean.md")), []);
  });

  test("checks unsaved buffers and drops stale findings", async () => {
    const document = await vscode.workspace.openTextDocument(pageUri("index.md"));
    await vscode.window.showTextDocument(document);
    const edit = new vscode.WorkspaceEdit();
    edit.replace(document.uri, new vscode.Range(2, 0, 2, 17), "[Clean](clean.md) [[wiki]]");
    assert.ok(await vscode.workspace.applyEdit(edit));
    assert.equal(document.isDirty, true);

    const diagnostics = await waitFor(
      "the diagnostics of the unsaved buffer",
      () => lorequillDiagnostics(document.uri).map(codeOf),
      (codes) => codes.length === 1 && codes[0] === "wikilinks",
    );
    assert.deepEqual(diagnostics, ["wikilinks"]);
    assert.equal(document.isDirty, true, "checking never saves");

    await vscode.commands.executeCommand("undo");
    await waitFor(
      "the original finding after undo",
      () => lorequillDiagnostics(document.uri).map(codeOf),
      (codes) => codes.length === 1 && codes[0] === "links",
    );
    await vscode.commands.executeCommand("workbench.action.revertAndCloseActiveEditor");
  });

  test("Check Pages returns a complete summary", async () => {
    const result = await api.checkPages();
    assert.ok(result);
    assert.equal(result.folders.length, 1);
    assert.deepEqual(
      {
        status: result.folders[0]?.status,
        findings: result.folders[0]?.findings,
        pages: result.folders[0]?.pagesChecked,
      },
      { status: "failed", findings: 1, pages: 2 },
    );
  });

  test("the command runs with a visible summary and never saves", async () => {
    await vscode.commands.executeCommand("lorequill.checkPages");
    assert.equal(
      vscode.workspace.textDocuments.some((document) => document.isDirty),
      false,
    );
  });
});
