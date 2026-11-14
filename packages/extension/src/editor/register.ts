import * as vscode from "vscode";
import type { Translate } from "../core/i18n";
import type { FolderRegistry } from "../folders/folder-registry";
import { pathInside } from "../folders/uri-paths";
import { LinkService } from "./link-service";
import { OutlineTreeProvider, REVEAL_HEADING_COMMAND } from "./outline-view";
import { PAGE_EDITOR_VIEW_TYPE, PageEditorProvider } from "./page-editor";
import { LINK_TRIGGER_CHARACTERS, TextLinkCompletionProvider } from "./text-link-completion";

export interface EditorFeature {
  readonly pageEditor: PageEditorProvider;
  readonly outline: OutlineTreeProvider;
  readonly links: LinkService;
}

/** Commands that the page editor forwards to its webview. */
const WEBVIEW_COMMANDS = {
  "lorequill.editor.find": "find",
  "lorequill.editor.replace": "replace",
  "lorequill.editor.viewEdit": "viewEdit",
  "lorequill.editor.viewBoth": "viewBoth",
  "lorequill.editor.viewPreview": "viewPreview",
} as const;

/**
 * The Lorequill page editor with its outline (`Outline`), Insert Link, link completion in the
 * text editor, the switch between the Lorequill and text editors, and the editor commands.
 */
export function registerEditor(
  subscriptions: vscode.Disposable[],
  extensionUri: vscode.Uri,
  registry: FolderRegistry,
  translate: Translate,
): EditorFeature {
  const links = new LinkService(registry, translate);
  const pageEditor = new PageEditorProvider(
    extensionUri,
    translate,
    (uri) => contentRootOf(registry, uri),
    links,
  );
  const outline = new OutlineTreeProvider(pageEditor);

  subscriptions.push(
    pageEditor,
    outline,
    vscode.window.registerCustomEditorProvider(PAGE_EDITOR_VIEW_TYPE, pageEditor, {
      supportsMultipleEditorsPerDocument: true,
    }),
    vscode.commands.registerCommand("lorequill.openInEditor", (uri: unknown) =>
      openWith(uri, PAGE_EDITOR_VIEW_TYPE),
    ),
    vscode.commands.registerCommand("lorequill.openAsText", (uri: unknown) =>
      openWith(uri, "default"),
    ),
    vscode.commands.registerCommand("lorequill.insertLink", async () => {
      const editor = vscode.window.activeTextEditor;
      if (pageEditor.activePage()) {
        pageEditor.runCommand("insertLink");
      } else if (editor) {
        await links.insertIntoTextEditor(editor);
      }
    }),
    vscode.languages.registerCompletionItemProvider(
      { language: "markdown" },
      new TextLinkCompletionProvider(links),
      ...LINK_TRIGGER_CHARACTERS,
    ),
    vscode.commands.registerCommand(REVEAL_HEADING_COMMAND, (line: unknown) => {
      outline.reveal(line);
    }),
    ...Object.entries(WEBVIEW_COMMANDS).map(([command, action]) =>
      vscode.commands.registerCommand(command, () => {
        pageEditor.runCommand(action);
      }),
    ),
    vscode.commands.registerCommand("lorequill.editor.undo", () => pageEditor.undoRedo("undo")),
    vscode.commands.registerCommand("lorequill.editor.redo", () => pageEditor.undoRedo("redo")),
  );
  return { pageEditor, outline, links };
}

/** The content root that contains a page, if the page belongs to a ready folder. */
function contentRootOf(registry: FolderRegistry, uri: vscode.Uri): vscode.Uri | undefined {
  return registry
    .models()
    .map(({ contentRoot }) => contentRoot)
    .find((root) => root !== undefined && pathInside(root, uri) !== undefined);
}

/** Opens a page in the Lorequill editor, or as text with `viewType` `default`. */
function openWith(uri: unknown, viewType: string): Thenable<unknown> | undefined {
  const target =
    uri instanceof vscode.Uri ? uri : vscode.window.tabGroups.activeTabGroup.activeTab?.input;
  const resource =
    target instanceof vscode.Uri
      ? target
      : target instanceof vscode.TabInputText || target instanceof vscode.TabInputCustom
        ? target.uri
        : undefined;
  return resource
    ? vscode.commands.executeCommand("vscode.openWith", resource, viewType)
    : undefined;
}
