import { PROFILE_RELATIVE_PATH } from "@lorequill/profile";
import * as vscode from "vscode";
import type { Translate } from "../core/i18n";
import type { FolderRegistry } from "../folders/folder-registry";
import { createPage, NEW_PAGE_COMMAND } from "./new-page-command";
import { OPEN_PROFILE_COMMAND, PAGES_VIEW_ID, PagesTreeProvider } from "./pages-view";

export interface PagesFeature {
  readonly provider: PagesTreeProvider;
  /** Filters the Pages tree and shows the filter in the view. */
  readonly setFilter: (text: string) => void;
}

/**
 * The Pages view (`Pages`) with its filter, refresh, profile, and page creation commands, and
 * the context key that tells the editor-title switch which files are pages.
 */
export function registerPages(
  subscriptions: vscode.Disposable[],
  registry: FolderRegistry,
  translate: Translate,
): PagesFeature {
  const provider = new PagesTreeProvider(registry, translate);
  const view = vscode.window.createTreeView(PAGES_VIEW_ID, {
    treeDataProvider: provider,
    showCollapseAll: true,
  });
  const showFilter = (): void => {
    view.description = provider.describeFilter() ?? "";
    void vscode.commands.executeCommand(
      "setContext",
      "lorequill.pagesFiltered",
      provider.getFilter() !== "",
    );
  };
  const setFilter = (text: string): void => {
    provider.setFilter(text);
    showFilter();
  };

  subscriptions.push(
    provider,
    view,
    registry.onDidChange(() => {
      publishPagePaths(registry);
    }),
    vscode.commands.registerCommand("lorequill.refreshPages", () => {
      registry.refresh();
    }),
    vscode.commands.registerCommand("lorequill.filterPages", async () => {
      const text = await vscode.window.showInputBox({
        prompt: translate("pages.filterPrompt"),
        placeHolder: translate("pages.filterPlaceholder"),
        value: provider.getFilter(),
      });
      if (text !== undefined) {
        setFilter(text);
      }
    }),
    vscode.commands.registerCommand("lorequill.clearPageFilter", () => {
      setFilter("");
    }),
    vscode.commands.registerCommand(OPEN_PROFILE_COMMAND, (folderUri: unknown, line: unknown) =>
      openProfile(registry, translate, folderUri, line),
    ),
    vscode.commands.registerCommand(NEW_PAGE_COMMAND, (element: unknown) =>
      createPage(registry, translate, element),
    ),
  );
  showFilter();
  return { provider, setFilter };
}

/** Pages in content scope, for the editor-title switch between the Lorequill and text editors. */
function publishPagePaths(registry: FolderRegistry): void {
  const paths: string[] = [];
  for (const model of registry.models()) {
    if (model.contentRoot) {
      for (const page of model.pages) {
        paths.push(vscode.Uri.joinPath(model.contentRoot, ...page.path.split("/")).fsPath);
      }
    }
  }
  void vscode.commands.executeCommand("setContext", "lorequill.pagePaths", paths);
}

/** Opens the profile of a folder, at `line` (1-based) when given. */
async function openProfile(
  registry: FolderRegistry,
  translate: Translate,
  folderUri: unknown,
  line: unknown,
): Promise<void> {
  let target = folderUri instanceof vscode.Uri ? folderUri : undefined;
  if (!target) {
    const folders = vscode.workspace.workspaceFolders ?? [];
    if (!registry.trusted || folders.length === 0) {
      return;
    }
    const [only] = folders;
    if (folders.length === 1 && only) {
      target = only.uri;
    } else {
      const picked = await vscode.window.showWorkspaceFolderPick();
      target = picked?.uri;
    }
  }
  if (!target) {
    return;
  }
  const selectionLine = typeof line === "number" && line >= 1 ? line - 1 : 0;
  const position = new vscode.Position(selectionLine, 0);
  try {
    await vscode.window.showTextDocument(
      vscode.Uri.joinPath(target, ...PROFILE_RELATIVE_PATH.split("/")),
      { selection: new vscode.Range(position, position) },
    );
  } catch {
    void vscode.window.showWarningMessage(translate("folder.profileMissing"));
  }
}
