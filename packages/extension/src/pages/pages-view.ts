import { createContentScope, type ContentScope, type Profile } from "@lorequill/profile";
import * as vscode from "vscode";
import { PAGE_EDITOR_VIEW_TYPE } from "../editor/page-editor";
import { describeStatus } from "../core/folder-status";
import { ENGINE_VERSION } from "@lorequill/checks";
import { engineMismatch } from "../core/engine-version";
import type { Translate } from "../core/i18n";
import {
  buildPageTree,
  createLabelCollator,
  filterPages,
  type DirectoryNode,
  type PageNode,
} from "../core/pages/tree";
import { MAX_SCANNED_ENTRIES } from "../core/pages/scan";
import type { FolderModel, FolderRegistry } from "../folders/folder-registry";

export const PAGES_VIEW_ID = "lorequill.pages";
export const OPEN_PROFILE_COMMAND = "lorequill.openProfile";

/** Elements of the Pages tree. */
export type PagesElement =
  | { readonly kind: "folder"; readonly model: FolderModel }
  | {
      readonly kind: "message";
      readonly model: FolderModel;
      readonly text: string;
      readonly status: "error" | "info";
      /** Explanation for a ready folder's message; selecting it opens the profile. */
      readonly detail?: string;
    }
  | { readonly kind: "directory"; readonly model: FolderModel; readonly node: DirectoryNode }
  | { readonly kind: "page"; readonly model: FolderModel; readonly node: PageNode };

/** A view of the page list of one folder, after filtering. */
interface FolderView {
  readonly root: DirectoryNode;
  readonly matchCount: number;
}

/**
 * The Pages tree in the Lorequill view container (specification sections 4 and 8). Labels come
 * from the page title; the description shows the file name when it differs. Pages open in the
 * Lorequill page editor. Tree texts use the VS Code display language; labels are ordered by the
 * locale of the folder's content.
 */
export class PagesTreeProvider implements vscode.TreeDataProvider<PagesElement>, vscode.Disposable {
  private readonly changeEmitter = new vscode.EventEmitter<PagesElement | undefined>();
  private readonly subscription: vscode.Disposable;
  private filter = "";
  /** Changes with every filter, so that VS Code applies the expansion state of new items. */
  private filterGeneration = 0;
  private readonly views = new WeakMap<FolderModel, { filter: string; view: FolderView }>();

  readonly onDidChangeTreeData = this.changeEmitter.event;

  constructor(
    private readonly registry: FolderRegistry,
    /** Interface texts follow the VS Code display language (specification section 4). */
    private readonly translate: Translate,
  ) {
    this.subscription = registry.onDidChange(() => {
      this.changeEmitter.fire(undefined);
    });
  }

  getFilter(): string {
    return this.filter;
  }

  setFilter(filter: string): void {
    this.filter = filter.trim();
    this.filterGeneration++;
    this.changeEmitter.fire(undefined);
  }

  dispose(): void {
    this.subscription.dispose();
    this.changeEmitter.dispose();
  }

  getChildren(element?: PagesElement): PagesElement[] {
    if (!element) {
      const models = this.registry.models();
      // A single folder is shown without a folder level; several folders each get a node.
      return models.length === 1 && models[0]
        ? this.contentOf(models[0], undefined)
        : models.map((model) => ({ kind: "folder", model }));
    }
    switch (element.kind) {
      case "folder":
        return this.contentOf(element.model, undefined);
      case "directory":
        return this.contentOf(element.model, element.node);
      case "message":
      case "page":
        return [];
    }
  }

  getTreeItem(element: PagesElement): vscode.TreeItem {
    switch (element.kind) {
      case "folder":
        return this.folderItem(element.model);
      case "message":
        return this.messageItem(element);
      case "directory":
        return this.directoryItem(element.model, element.node);
      case "page":
        return this.pageItem(element.model, element.node);
    }
  }

  private contentOf(model: FolderModel, directory: DirectoryNode | undefined): PagesElement[] {
    const translate = this.translate;
    if (model.status.kind !== "ready") {
      const description = describeStatus(model.status, translate);
      return [{ kind: "message", model, text: description.message, status: "error" }];
    }
    const view = this.viewOf(model);
    if (directory) {
      return directory.children.map((node) =>
        node.kind === "directory"
          ? { kind: "directory", model, node }
          : { kind: "page", model, node },
      );
    }

    const elements: PagesElement[] = [];
    const mismatch = engineMismatch(model.status.profile, ENGINE_VERSION);
    if (mismatch) {
      elements.push({
        kind: "message",
        model,
        text: translate("pages.engineMismatch", { ...mismatch }),
        status: "error",
        detail: translate("pages.engineMismatchDetail"),
      });
    }
    if (model.truncated) {
      elements.push({
        kind: "message",
        model,
        text: translate("pages.truncated", { limit: MAX_SCANNED_ENTRIES }),
        status: "info",
      });
    }
    if (view.matchCount === 0) {
      elements.push({
        kind: "message",
        model,
        text:
          this.filter === ""
            ? translate("pages.none")
            : translate("pages.noMatch", { filter: this.filter }),
        status: "info",
      });
    }
    return [
      ...elements,
      ...view.root.children.map((node): PagesElement =>
        node.kind === "directory"
          ? { kind: "directory", model, node }
          : { kind: "page", model, node },
      ),
    ];
  }

  private viewOf(model: FolderModel): FolderView {
    const cached = this.views.get(model);
    if (cached?.filter === this.filter) {
      return cached.view;
    }
    const pages = filterPages(model.pages, this.filter);
    const view: FolderView = {
      root: buildPageTree(pages, createLabelCollator(model.contentLocale)),
      matchCount: pages.length,
    };
    this.views.set(model, { filter: this.filter, view });
    return view;
  }

  private itemId(model: FolderModel, suffix: string): string {
    return `${model.folder.uri.toString()}|${String(this.filterGeneration)}|${suffix}`;
  }

  private folderItem(model: FolderModel): vscode.TreeItem {
    const item = new vscode.TreeItem(model.folder.name, vscode.TreeItemCollapsibleState.Expanded);
    item.id = this.itemId(model, "folder");
    item.resourceUri = model.folder.uri;
    item.iconPath = vscode.ThemeIcon.Folder;
    item.contextValue = "folder";
    return item;
  }

  private messageItem(element: Extract<PagesElement, { kind: "message" }>): vscode.TreeItem {
    const { model } = element;
    const translate = this.translate;
    const item = new vscode.TreeItem(element.text, vscode.TreeItemCollapsibleState.None);
    item.id = this.itemId(model, `message|${element.text}`);
    item.iconPath = new vscode.ThemeIcon(element.status === "error" ? "warning" : "info");
    item.contextValue = "message";
    if (model.status.kind !== "ready") {
      const description = describeStatus(model.status, translate);
      item.tooltip =
        description.details.length > 0
          ? new vscode.MarkdownString(
              description.details.map((line) => `- ${escapeMarkdown(line)}`).join("\n"),
            )
          : element.text;
      if (description.canOpenProfile) {
        item.command = {
          command: OPEN_PROFILE_COMMAND,
          title: translate("action.openProfile"),
          arguments: [model.folder.uri, description.profileLine],
        };
      }
    } else if (element.detail !== undefined) {
      item.tooltip = element.detail;
      item.command = {
        command: OPEN_PROFILE_COMMAND,
        title: translate("action.openProfile"),
        arguments: [model.folder.uri],
      };
    }
    return item;
  }

  private directoryItem(model: FolderModel, node: DirectoryNode): vscode.TreeItem {
    const state =
      this.filter === ""
        ? vscode.TreeItemCollapsibleState.Collapsed
        : vscode.TreeItemCollapsibleState.Expanded;
    const item = new vscode.TreeItem(node.name, state);
    item.id = this.itemId(model, `directory|${node.path}`);
    item.iconPath = vscode.ThemeIcon.Folder;
    if (model.contentRoot) {
      item.resourceUri = vscode.Uri.joinPath(model.contentRoot, ...node.path.split("/"));
    }
    item.contextValue = "directory";
    return item;
  }

  private pageItem(model: FolderModel, node: PageNode): vscode.TreeItem {
    const { page } = node;
    const translate = this.translate;
    const item = new vscode.TreeItem(page.title, vscode.TreeItemCollapsibleState.None);
    item.id = this.itemId(model, `page|${page.path}`);
    const draft = model.status.kind === "ready" && scopeOf(model.status.profile).isDraft(page.path);
    const description = [
      ...(page.title === page.fileName ? [] : [page.fileName]),
      ...(draft ? [translate("pages.draft")] : []),
    ];
    if (description.length > 0) {
      item.description = description.join(" · ");
    }
    item.contextValue = "page";
    item.tooltip = [
      page.path,
      ...(draft ? [translate("pages.draftDetail")] : []),
      ...(page.frontMatter === "invalid" ? [translate("pages.frontMatterInvalid")] : []),
    ].join("\n");
    if (model.contentRoot) {
      const uri = vscode.Uri.joinPath(model.contentRoot, ...page.path.split("/"));
      item.resourceUri = uri;
      item.command = {
        command: "vscode.openWith",
        title: translate("action.openPage"),
        arguments: [uri, PAGE_EDITOR_VIEW_TYPE],
      };
    }
    return item;
  }

  /** Text shown next to the view title while a filter is active. */
  describeFilter(): string | undefined {
    if (this.filter === "") {
      return undefined;
    }
    return this.translate("pages.filterActive", { filter: this.filter });
  }
}

function escapeMarkdown(text: string): string {
  return text.replace(/[\\`*_{}[\]()#+\-.!|<>~]/g, (character) => `\\${character}`);
}

const scopes = new WeakMap<Profile, ContentScope>();

/** The content scope of a profile, compiled once per loaded profile. */
function scopeOf(profile: Profile): ContentScope {
  let scope = scopes.get(profile);
  if (!scope) {
    scope = createContentScope(profile.content);
    scopes.set(profile, scope);
  }
  return scope;
}
