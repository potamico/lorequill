import * as vscode from "vscode";
import { buildOutline, headingAt, type OutlineNode } from "../core/outline";
import type { PageEditorProvider } from "./page-editor";

export const OUTLINE_VIEW_ID = "lorequill.outline";
export const REVEAL_HEADING_COMMAND = "lorequill.outline.reveal";

/** How long the outline waits after typing before it reads the headings again. */
const REFRESH_DELAY_MS = 300;

/**
 * The page outline (`Outline`, specification §8, decision D26): the headings of the page in the
 * active Lorequill editor as a tree. Selecting a heading moves the editor's cursor there; moving
 * the cursor selects the heading of the current section. The built-in Outline view does not cover
 * custom editors, so Lorequill provides its own.
 */
export class OutlineTreeProvider
  implements vscode.TreeDataProvider<OutlineNode>, vscode.Disposable
{
  private readonly changeEmitter = new vscode.EventEmitter<undefined>();
  private readonly subscriptions: vscode.Disposable[];
  private readonly view: vscode.TreeView<OutlineNode>;
  private roots: OutlineNode[] = [];
  private refreshTimer: ReturnType<typeof setTimeout> | undefined;

  readonly onDidChangeTreeData = this.changeEmitter.event;

  constructor(private readonly editors: PageEditorProvider) {
    this.view = vscode.window.createTreeView(OUTLINE_VIEW_ID, {
      treeDataProvider: this,
      showCollapseAll: true,
    });
    this.subscriptions = [
      this.view,
      this.changeEmitter,
      editors.onDidChangeActivePage(() => {
        this.refresh();
      }),
      editors.onDidChangeCursor(() => {
        this.followCursor();
      }),
      vscode.workspace.onDidChangeTextDocument((event) => {
        if (event.document === this.editors.activePage()?.document) {
          clearTimeout(this.refreshTimer);
          this.refreshTimer = setTimeout(() => {
            this.refresh();
          }, REFRESH_DELAY_MS);
        }
      }),
      this.view.onDidChangeVisibility(() => {
        this.followCursor();
      }),
    ];
    this.refresh();
  }

  /** The current outline, for integration tests. */
  outline(): readonly OutlineNode[] {
    return this.roots;
  }

  getChildren(element?: OutlineNode): OutlineNode[] {
    return [...(element ? element.children : this.roots)];
  }

  getParent(element: OutlineNode): OutlineNode | undefined {
    return element.parent;
  }

  getTreeItem(element: OutlineNode): vscode.TreeItem {
    const item = new vscode.TreeItem(
      element.text,
      element.children.length > 0
        ? vscode.TreeItemCollapsibleState.Expanded
        : vscode.TreeItemCollapsibleState.None,
    );
    item.iconPath = new vscode.ThemeIcon("symbol-string");
    item.tooltip = `${"#".repeat(element.level)} ${element.text}`;
    item.command = {
      command: REVEAL_HEADING_COMMAND,
      title: element.text,
      arguments: [element.line],
    };
    return item;
  }

  /** Moves the cursor of the active Lorequill editor to a heading. */
  reveal(line: unknown): void {
    if (typeof line === "number" && Number.isSafeInteger(line) && line >= 0) {
      this.editors.revealLine(line);
    }
  }

  private refresh(): void {
    clearTimeout(this.refreshTimer);
    const page = this.editors.activePage();
    this.roots = page ? buildOutline(page.document.getText()) : [];
    void vscode.commands.executeCommand(
      "setContext",
      "lorequill.outlineState",
      page ? (this.roots.length > 0 ? "headings" : "empty") : "none",
    );
    this.changeEmitter.fire(undefined);
    this.followCursor();
  }

  /** Selects the heading of the section that contains the cursor, like the built-in Outline. */
  private followCursor(): void {
    const page = this.editors.activePage();
    if (!page || !this.view.visible) {
      return;
    }
    const current = headingAt(this.roots, page.line);
    if (current) {
      // Fails harmlessly when the tree was replaced in the meantime.
      this.view.reveal(current, { select: true, focus: false }).then(undefined, () => undefined);
    }
  }

  dispose(): void {
    clearTimeout(this.refreshTimer);
    this.subscriptions.forEach((subscription) => {
      subscription.dispose();
    });
  }
}
