import * as assert from "node:assert/strict";
import * as path from "node:path";
import * as vscode from "vscode";
import { activateExtension, waitFor, type InternalApi } from "../support";

const VIEW_TYPE = "lorequill.pageEditor";

function fileUri(...segments: string[]): vscode.Uri {
  const folder = vscode.workspace.workspaceFolders?.[0];
  assert.ok(folder, "a workspace folder is open");
  return vscode.Uri.file(path.join(folder.uri.fsPath, ...segments));
}

async function documentOf(uri: vscode.Uri): Promise<vscode.TextDocument> {
  return vscode.workspace.openTextDocument(uri);
}

/** Shows the Properties view and waits until it shows `page`. */
async function propertiesOf(api: InternalApi, page: string): Promise<{ status: string }> {
  await vscode.commands.executeCommand("lorequill.properties.focus");
  api.properties.refresh();
  await api.properties.idle();
  const model = await waitFor(
    `the Properties view to show ${page}`,
    () => api.properties.lastModel,
    (candidate) => candidate?.page === page,
  );
  assert.ok(model);
  return model;
}

const body = (text: string): string => text.slice(text.indexOf("\n---\n") + 5);

suite("Properties view", () => {
  let api: InternalApi;
  const access = (): vscode.Uri => fileUri("docs", "iam", "concepts", "access.md");

  suiteSetup(async () => {
    api = await activateExtension();
  });

  teardown(async () => {
    await vscode.commands.executeCommand("workbench.action.revertAndCloseActiveEditor");
    await vscode.commands.executeCommand("workbench.action.closeAllEditors");
  });

  test("shows the collection fields of the page in the Lorequill editor", async () => {
    await vscode.commands.executeCommand("vscode.openWith", access(), VIEW_TYPE);
    const model = await propertiesOf(api, "iam/concepts/access.md");
    assert.equal(model.status, "ok");
    const fields = (model as unknown as { fields: { key: string; value?: unknown }[] }).fields;
    assert.deepEqual(
      fields.map(({ key }) => key),
      ["title", "status", "reviewed", "aliases"],
    );
    assert.equal(fields[0]?.value, "Access");
  });

  test("changes only the title, as one undoable edit (AT 3, 4, 54)", async () => {
    await vscode.commands.executeCommand("vscode.openWith", access(), VIEW_TYPE);
    await propertiesOf(api, "iam/concepts/access.md");
    const document = await documentOf(access());
    const before = document.getText();

    assert.equal(
      await api.properties.applyRequest({ type: "set", key: "title", value: "Access control" }),
      true,
    );
    const after = document.getText();
    assert.match(after, /title: Access control\n/);
    assert.match(after, /# keep this comment\n/);
    assert.match(after, /custom: kept\n/);
    assert.equal(body(after), body(before));
    assert.ok(document.isDirty);

    await vscode.commands.executeCommand("undo");
    await waitFor(
      "undo",
      () => document.getText(),
      (text) => text === before,
    );
    await vscode.commands.executeCommand("redo");
    await waitFor(
      "redo",
      () => document.getText(),
      (text) => text === after,
    );
  });

  test("writes dates quoted and keeps lists as lists (AT 5)", async () => {
    await vscode.commands.executeCommand("vscode.openWith", access(), VIEW_TYPE);
    await propertiesOf(api, "iam/concepts/access.md");
    const document = await documentOf(access());
    assert.equal(
      await api.properties.applyRequest({ type: "set", key: "reviewed", value: "2026-11-10" }),
      true,
    );
    assert.equal(
      await api.properties.applyRequest({ type: "set", key: "aliases", value: ["IAM", "Zugang"] }),
      true,
    );
    const text = document.getText();
    assert.match(text, /reviewed: ["']2026-11-10["']/);
    // The existing flow style of the list is kept.
    assert.match(text, /aliases: \[IAM, Zugang\]\n/);
  });

  test("keeps a body edit made while a property is saved (AT 8)", async () => {
    await vscode.commands.executeCommand("vscode.openWith", access(), VIEW_TYPE);
    await propertiesOf(api, "iam/concepts/access.md");
    const document = await documentOf(access());
    const bodyEdit = new vscode.WorkspaceEdit();
    bodyEdit.insert(access(), new vscode.Position(document.lineCount - 1, 0), "Added line\n");
    const [property, applied] = await Promise.all([
      api.properties.applyRequest({ type: "set", key: "status", value: "approved" }),
      vscode.workspace.applyEdit(bodyEdit),
    ]);
    assert.equal(property, true);
    assert.equal(applied, true);
    const text = document.getText();
    assert.match(text, /status: approved\n/);
    assert.match(text, /Added line\n/);
  });

  test("follows a page opened in the text editor and does not edit unsafe YAML (AT 4)", async () => {
    const broken = fileUri("docs", "broken.md");
    await vscode.window.showTextDocument(broken);
    const model = await propertiesOf(api, "broken.md");
    assert.equal(model.status, "readonly");
    const document = await documentOf(broken);
    const before = document.getText();
    assert.equal(
      await api.properties.applyRequest({ type: "set", key: "title", value: "c" }),
      false,
    );
    assert.equal(document.getText(), before);
    assert.equal(document.isDirty, false);
  });

  test("shows nothing for Markdown outside the content root", async () => {
    await vscode.window.showTextDocument(fileUri("README.md"));
    await vscode.commands.executeCommand("lorequill.properties.focus");
    api.properties.refresh();
    await api.properties.idle();
    await waitFor(
      "the empty state",
      () => api.properties.lastModel?.status,
      (status) => status === "empty",
    );
  });
});
