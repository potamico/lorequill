import * as assert from "node:assert/strict";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import * as path from "node:path";
import * as vscode from "vscode";
import { profileYaml } from "../../workspaces";
import {
  activateExtension,
  findExtension,
  outline,
  waitFor,
  type EditorSessionProbe,
  type InternalApi,
  WEBVIEW_TIMEOUT_MS,
} from "../support";

const VIEW_TYPE = "lorequill.pageEditor";

function folderPath(): string {
  const folder = vscode.workspace.workspaceFolders?.[0];
  assert.ok(folder, "a workspace folder is open");
  return folder.uri.fsPath;
}

function fileUri(...segments: string[]): vscode.Uri {
  return vscode.Uri.file(path.join(folderPath(), ...segments));
}

type Sent = EditorSessionProbe["sent"][number];

/** The last `context` message a session received. */
function contextOf(probe: EditorSessionProbe): Sent | undefined {
  return probe.sent.filter(({ type }) => type === "context").at(-1);
}

async function session(api: InternalApi, uri: vscode.Uri): Promise<EditorSessionProbe> {
  await vscode.commands.executeCommand("vscode.openWith", uri, VIEW_TYPE);
  const found = await waitFor(
    "the editor session",
    () => api.editorSessions().find((candidate) => candidate.uri.fsPath === uri.fsPath),
    (candidate) => candidate?.sent.some(({ type }) => type === "context") === true,
    WEBVIEW_TIMEOUT_MS,
  );
  assert.ok(found);
  return found;
}

async function completions(
  probe: EditorSessionProbe,
  id: number,
  anchorsOf?: string,
): Promise<{ label: string; detail?: string }[]> {
  await probe.receive({ type: "complete", id, ...(anchorsOf === undefined ? {} : { anchorsOf }) });
  const answer = await waitFor(
    `completions ${String(id)}`,
    () => probe.sent.find((message) => message.type === "completions" && message.id === id),
    (message) => message !== undefined,
  );
  return (answer as unknown as { items: { label: string; detail?: string }[] }).items;
}

// The page editor in a folder without a profile (#10): the editor, Outline, Properties, and links
// work on plain Markdown files; pages, checks, and the Git actions need a profile.
suite("Plain editing (folder without a profile)", () => {
  let api: InternalApi;
  const first = (): vscode.Uri => fileUri("notes", "first.md");
  const profile = (): string => path.join(folderPath(), ".lorequill", "config.yaml");

  teardown(async () => {
    await vscode.commands.executeCommand("workbench.action.revertAndCloseActiveEditor");
    await vscode.commands.executeCommand("workbench.action.closeAllEditors");
    await rm(path.dirname(profile()), { recursive: true, force: true });
  });

  test("the extension stays inactive until the editor is opened", async () => {
    const extension = findExtension();
    assert.equal(extension.isActive, false, "nothing activates Lorequill without a profile");

    await vscode.commands.executeCommand("vscode.openWith", first(), VIEW_TYPE);
    await waitFor(
      "the extension to activate",
      () => extension.isActive,
      (active) => active,
      WEBVIEW_TIMEOUT_MS,
    );
    const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
    assert.ok(input instanceof vscode.TabInputCustom, "a custom editor tab is active");
    assert.equal(input.viewType, VIEW_TYPE);
  });

  test("opens a plain file with the editor alone and images from the folder", async () => {
    api = await activateExtension();
    const probe = await session(api, first());
    const context = contextOf(probe);
    assert.ok(context);
    assert.equal(context.managed, false, "no Check Pages, Commit, or Submit in the toolbar");
    assert.equal((context.page as { path?: string } | undefined)?.path, "notes/first.md");
  });

  test("explains the missing profile in the Pages view without an error", async () => {
    api = await activateExtension();
    const lines = await waitFor(
      "the Pages view",
      () => outline(api.pagesTree()),
      (tree) => tree.length > 0,
    );
    assert.equal(lines.length, 1);
    assert.match(lines[0] ?? "", /No profile found/);
    assert.match(lines[0] ?? "", /The editor works on any Markdown file/);
    assert.equal(api.pagesTree()[0]?.command, "vscode.open", "opens Getting started");
  });

  test("offers the Markdown files of the folder as link targets", async () => {
    api = await activateExtension();
    const probe = await session(api, first());
    const pages = await completions(probe, 1);
    assert.deepEqual(pages.map(({ label, detail }) => `${label} | ${detail ?? ""}`).sort(), [
      "../README.md | Readme",
      "second.md | Second Note",
    ]);
    const anchors = await completions(probe, 2, "");
    assert.deepEqual(
      anchors.map(({ label }) => label),
      ["first", "details"],
    );
  });

  test("edits the front matter of a plain file in the Properties view", async () => {
    api = await activateExtension();
    await session(api, first());
    await vscode.commands.executeCommand("lorequill.properties.focus");
    api.properties.refresh();
    await api.properties.idle();
    const model = await waitFor(
      "the Properties view to show the file",
      () => api.properties.lastModel,
      (candidate) => candidate?.page === "first.md",
    );
    assert.ok(model);
    assert.equal(model.status, "ok");
    // Without a collection, every key is shown in the generic view with an inferred widget.
    const { fields, unknown } = model as unknown as {
      fields: unknown[];
      unknown: { key: string }[];
    };
    assert.deepEqual(fields, []);
    assert.deepEqual(
      unknown.map(({ key }) => key),
      ["title", "tags"],
    );

    assert.equal(
      await api.properties.applyRequest({ type: "set", key: "title", value: "Renamed" }),
      true,
    );
    const document = await vscode.workspace.openTextDocument(first());
    assert.match(document.getText(), /^---\ntitle: Renamed\ntags: \[a, b\]\n---\n# First\n/);
  });

  test("becomes managed when the folder gets a profile, and plain again without it", async () => {
    api = await activateExtension();
    const probe = await session(api, first());
    assert.equal(contextOf(probe)?.managed, false);

    await mkdir(path.dirname(profile()), { recursive: true });
    await writeFile(profile(), profileYaml({ locale: "en", root: "notes" }));
    const managed = await waitFor(
      "the editor to become managed",
      () => contextOf(probe),
      (context) => context?.managed === true,
    );
    // The page now lies in a content root: images load from there.
    assert.equal((managed?.page as { path?: string } | undefined)?.path, "first.md");
    assert.equal(await readFile(first().fsPath, "utf8").then((text) => text.length > 0), true);

    await rm(path.dirname(profile()), { recursive: true, force: true });
    await waitFor(
      "the editor to become plain again",
      () => contextOf(probe),
      (context) => context?.managed === false,
    );
  });
});
