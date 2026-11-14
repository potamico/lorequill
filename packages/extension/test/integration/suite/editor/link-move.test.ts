import * as assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { rm, writeFile } from "node:fs/promises";
import * as path from "node:path";
import * as vscode from "vscode";
import {
  activateExtension,
  waitFor,
  type InternalApi,
  type TreeSnapshot,
  WEBVIEW_TIMEOUT_MS,
} from "../support";

function fileUri(...segments: string[]): vscode.Uri {
  const folder = vscode.workspace.workspaceFolders?.[0];
  assert.ok(folder, "a workspace folder is open");
  return vscode.Uri.file(path.join(folder.uri.fsPath, ...segments));
}

function resources(nodes: readonly TreeSnapshot[]): string[] {
  return nodes.flatMap((node) => [
    ...(node.resource ? [node.resource] : []),
    ...resources(node.children),
  ]);
}

suite("Links follow moved pages", () => {
  let api: InternalApi;

  /** Moves a file like the Explorer does, then waits until the Pages view shows it. */
  async function move(from: vscode.Uri, to: vscode.Uri): Promise<void> {
    const edit = new vscode.WorkspaceEdit();
    edit.renameFile(from, to);
    assert.ok(await vscode.workspace.applyEdit(edit));
    // A file watcher that is still starting can miss the move; rescan explicitly.
    await vscode.commands.executeCommand("lorequill.refreshPages");
    await waitFor(
      `the Pages view to show ${to.fsPath}`,
      () => resources(api.pagesTree()),
      (paths) => paths.includes(to.fsPath) && !paths.includes(from.fsPath),
    );
  }

  const text = (uri: vscode.Uri): string => readFileSync(uri.fsPath, "utf8");

  /**
   * Waits until a page's link update is complete: the file on disk is as expected, and an open
   * document of it is saved and agrees with the disk. A move made before that would race the
   * update of the previous one, which a real user never does within milliseconds.
   */
  async function settled(
    description: string,
    uri: vscode.Uri,
    accept: (current: string) => boolean,
  ): Promise<void> {
    await waitFor(
      description,
      () => {
        const document = vscode.workspace.textDocuments.find(
          ({ uri: open }) => open.fsPath === uri.fsPath,
        );
        return {
          disk: text(uri),
          dirty: document?.isDirty ?? false,
          document: document?.getText(),
        };
      },
      ({ disk, dirty, document }) =>
        accept(disk) && !dirty && (document === undefined || document === disk),
    );
  }

  suiteSetup(async () => {
    api = await activateExtension();
    await waitFor(
      "the pages to load",
      () => api.pagesTree().length,
      (count) => count > 0,
    );
  });

  teardown(async () => {
    await vscode.commands.executeCommand("workbench.action.closeAllEditors");
  });

  test("updates and saves links to a moved page and the moved page's own links, and back", async () => {
    const links = fileUri("docs", "links.md");
    const second = fileUri("docs", "second.md");
    const original = text(links);
    const secondText = text(second);
    try {
      await vscode.commands.executeCommand("vscode.openWith", links, "lorequill.pageEditor");
      await waitFor(
        "the editor session",
        () => api.editorSessions().some(({ uri }) => uri.fsPath === links.fsPath),
        Boolean,
        WEBVIEW_TIMEOUT_MS,
      );

      const moved = fileUri("docs", "archive", "second.md");
      await move(second, moved);
      await settled("links.md to point at the moved page, saved", links, (current) =>
        current.includes("[Second](archive/second.md)"),
      );

      // The linking page moves too: its own relative links follow.
      const deep = fileUri("docs", "nested", "deeper", "links.md");
      await move(links, deep);
      await settled(
        "the moved page's links to be rewritten, saved",
        deep,
        (current) =>
          current.includes("[Second](../../archive/second.md)") &&
          current.includes("[Install](../../outline.md#install)"),
      );

      // And back, one move at a time.
      await move(deep, links);
      await settled(
        "the page's links to follow it back, saved",
        links,
        (current) =>
          current.includes("[Second](archive/second.md)") &&
          current.includes("[Install](outline.md#install)"),
      );
      await move(moved, second);
      await settled("the links to be restored, saved", links, (current) => current === original);
    } finally {
      // Leave the workspace as the other suites expect it, also after a failure.
      await vscode.commands.executeCommand("workbench.action.closeAllEditors");
      for (const stray of ["archive", "nested"]) {
        await rm(fileUri("docs", stray).fsPath, { recursive: true, force: true });
      }
      await writeFile(links.fsPath, original);
      await writeFile(second.fsPath, secondText);
      await vscode.commands.executeCommand("lorequill.refreshPages");
    }
  });

  test("leaves pages alone when the setting is off", async () => {
    const config = vscode.workspace.getConfiguration("lorequill");
    await config.update("links.updateOnMove", false, vscode.ConfigurationTarget.Workspace);
    const outline = fileUri("docs", "outline.md");
    const outlineText = text(outline);
    try {
      const links = fileUri("docs", "links.md");
      const original = text(links);
      const moved = fileUri("docs", "elsewhere", "outline.md");
      await move(outline, moved);
      // Give a (wrong) update time to happen before checking that none did.
      await new Promise((resolve) => setTimeout(resolve, 1000));
      assert.equal(text(links), original);
      await move(moved, outline);
    } finally {
      await config.update("links.updateOnMove", undefined, vscode.ConfigurationTarget.Workspace);
      await rm(fileUri("docs", "elsewhere").fsPath, { recursive: true, force: true });
      await writeFile(outline.fsPath, outlineText);
      await vscode.commands.executeCommand("lorequill.refreshPages");
    }
  });

  test("copies the stable link of a page, and explains when there is none", async () => {
    const page = fileUri("docs", "stable.md");
    await writeFile(page.fsPath, "---\ntitle: Stable\nid: BOK-9\n---\n# Stable\n");
    try {
      const result = await vscode.commands.executeCommand("lorequill.copyStableLink", page);
      assert.deepEqual(result, { kind: "link", url: "https://docs.example.org/id/BOK-9/" });
      assert.equal(await vscode.env.clipboard.readText(), "https://docs.example.org/id/BOK-9/");

      const second = fileUri("docs", "second.md");
      assert.deepEqual(await vscode.commands.executeCommand("lorequill.copyStableLink", second), {
        kind: "no-value",
        field: "id",
      });
    } finally {
      await rm(page.fsPath, { force: true });
    }
  });
});
