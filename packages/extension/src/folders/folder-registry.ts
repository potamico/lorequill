import { stat } from "node:fs/promises";
import * as path from "node:path";
import { createContentScope, loadProfile } from "@lorequill/profile";
import * as vscode from "vscode";
import { classifyProfileResult, type FolderStatus } from "../core/folder-status";
import { selectLocale, type Locale } from "../core/i18n";
import type { Logger } from "../core/logger";
import { scanPages, type PageCache, type PageEntry } from "../core/pages/scan";

/** What is known about one workspace folder after loading its profile and scanning its pages. */
export interface FolderModel {
  readonly folder: vscode.WorkspaceFolder;
  readonly status: FolderStatus;
  /**
   * Locale of the repository content: the profile `locale`, or the VS Code display language while
   * there is none. It orders page labels; interface texts always use the display language.
   */
  readonly contentLocale: Locale;
  /** Included pages, sorted by path. Empty unless the status is `ready`. */
  readonly pages: readonly PageEntry[];
  /** The scan stopped at its entry limit, so `pages` is incomplete. */
  readonly truncated: boolean;
  /** Directory of the content root; only for a ready folder. */
  readonly contentRoot?: vscode.Uri;
}

interface FolderEntry {
  readonly folder: vscode.WorkspaceFolder;
  readonly index: number;
  readonly cache: PageCache;
  readonly disposables: vscode.Disposable[];
  contentWatcher?: { root: string; watcher: vscode.Disposable };
  model?: FolderModel | undefined;
  timer?: NodeJS.Timeout;
  controller?: AbortController;
}

/** Waiting time that merges the burst of file events of a Git operation into one refresh. */
const REFRESH_DELAY_MS = 250;

/** Size and modification time of a file, or `missing`, to tell whether it changed. */
async function fileStamp(file: string): Promise<string> {
  try {
    const info = await stat(file);
    return `${String(info.size)}:${String(info.mtimeMs)}`;
  } catch {
    return "missing";
  }
}

const IGNORED_SEGMENTS: ReadonlySet<string> = new Set([".git", "node_modules"]);

function isIgnoredEvent(uri: vscode.Uri): boolean {
  return uri.path.split("/").some((segment) => IGNORED_SEGMENTS.has(segment));
}

/**
 * Keeps one independent model per workspace folder (specification section 4). Nothing is read
 * from a folder while the workspace is not trusted. The profile and the pages are reloaded when
 * `.lorequill/config.yaml` or a file below the content root changes.
 */
export class FolderRegistry implements vscode.Disposable {
  private readonly entries = new Map<string, FolderEntry>();
  private readonly subscriptions: vscode.Disposable[] = [];
  private readonly changeEmitter = new vscode.EventEmitter<void>();
  private nextIndex = 0;

  readonly onDidChange = this.changeEmitter.event;

  constructor(private readonly logger: Logger) {}

  get trusted(): boolean {
    return vscode.workspace.isTrusted;
  }

  /** Folder models in workspace order. Empty while the workspace is not trusted. */
  models(): readonly FolderModel[] {
    if (!this.trusted) {
      return [];
    }
    return (vscode.workspace.workspaceFolders ?? []).flatMap((folder) => {
      const model = this.entries.get(folder.uri.toString())?.model;
      return model ? [model] : [];
    });
  }

  /** Number of folders whose profile has been read. Zero for every folder while untrusted. */
  loadedFolderCount(): number {
    return [...this.entries.values()].filter((entry) => entry.model !== undefined).length;
  }

  start(): void {
    this.logger.info("workspace-trust", { state: this.trusted ? "trusted" : "untrusted" });
    for (const folder of vscode.workspace.workspaceFolders ?? []) {
      this.addFolder(folder);
    }
    this.subscriptions.push(
      vscode.workspace.onDidChangeWorkspaceFolders((event) => {
        for (const folder of event.removed) {
          this.removeFolder(folder);
        }
        for (const folder of event.added) {
          this.addFolder(folder);
        }
        this.changeEmitter.fire();
      }),
      vscode.workspace.onDidGrantWorkspaceTrust(() => {
        this.logger.info("workspace-trust", { state: "trusted" });
        this.refresh();
      }),
    );
  }

  /** Reloads every folder immediately. */
  refresh(): void {
    for (const entry of this.entries.values()) {
      this.schedule(entry, 0);
    }
    this.changeEmitter.fire();
  }

  dispose(): void {
    for (const folder of [...this.entries.values()]) {
      this.disposeEntry(folder);
    }
    this.entries.clear();
    for (const subscription of this.subscriptions) {
      subscription.dispose();
    }
    this.changeEmitter.dispose();
  }

  private addFolder(folder: vscode.WorkspaceFolder): void {
    const key = folder.uri.toString();
    if (this.entries.has(key)) {
      return;
    }
    const entry: FolderEntry = {
      folder,
      index: this.nextIndex++,
      cache: new Map(),
      disposables: [],
    };
    this.entries.set(key, entry);
    this.logger.info("folder-added", { folder: entry.index });
    if (this.trusted && folder.uri.scheme === "file") {
      this.watchProfile(entry);
    }
    this.schedule(entry, 0);
  }

  private removeFolder(folder: vscode.WorkspaceFolder): void {
    const key = folder.uri.toString();
    const entry = this.entries.get(key);
    if (entry) {
      this.logger.info("folder-removed", { folder: entry.index });
      this.disposeEntry(entry);
      this.entries.delete(key);
    }
  }

  private disposeEntry(entry: FolderEntry): void {
    clearTimeout(entry.timer);
    entry.controller?.abort();
    entry.contentWatcher?.watcher.dispose();
    for (const disposable of entry.disposables) {
      disposable.dispose();
    }
  }

  private watchProfile(entry: FolderEntry): void {
    if (entry.disposables.length > 0) {
      return;
    }
    const watcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(entry.folder, ".lorequill/config.yaml"),
    );
    const refresh = (): void => {
      this.schedule(entry, REFRESH_DELAY_MS);
    };
    entry.disposables.push(
      watcher,
      watcher.onDidCreate(refresh),
      watcher.onDidChange(refresh),
      watcher.onDidDelete(refresh),
    );
  }

  private watchContent(entry: FolderEntry, root: vscode.Uri): void {
    const key = root.toString();
    if (entry.contentWatcher?.root === key) {
      return;
    }
    entry.contentWatcher?.watcher.dispose();
    const watcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(root, "**"),
    );
    const refresh = (uri: vscode.Uri): void => {
      if (!isIgnoredEvent(uri)) {
        this.schedule(entry, REFRESH_DELAY_MS);
      }
    };
    entry.contentWatcher = {
      root: key,
      watcher: vscode.Disposable.from(
        watcher,
        watcher.onDidCreate(refresh),
        watcher.onDidChange(refresh),
        watcher.onDidDelete(refresh),
      ),
    };
  }

  private schedule(entry: FolderEntry, delayMs: number): void {
    clearTimeout(entry.timer);
    entry.timer = setTimeout(() => {
      void this.load(entry);
    }, delayMs);
  }

  private async load(entry: FolderEntry): Promise<void> {
    entry.controller?.abort();
    const controller = new AbortController();
    entry.controller = controller;

    const displayLocale = selectLocale(vscode.env.language);
    const { folder } = entry;
    const finish = (model: FolderModel | undefined): void => {
      if (controller.signal.aborted) {
        return;
      }
      entry.model = model;
      this.changeEmitter.fire();
    };

    // Nothing is read from the folder in an untrusted workspace.
    if (!this.trusted) {
      entry.contentWatcher?.watcher.dispose();
      delete entry.contentWatcher;
      finish(undefined);
      return;
    }
    if (folder.uri.scheme !== "file") {
      this.logger.warn("profile-loaded", { folder: entry.index, status: "unsupported-location" });
      finish(emptyModel(folder, { kind: "unsupported-location" }, displayLocale));
      return;
    }
    this.watchProfile(entry);

    // A profile that changes while it is read, as when an editor empties the file before writing
    // it, is read again instead of showing the half-written state; its change event may already
    // have been handled.
    const profileFile = path.join(folder.uri.fsPath, ".lorequill", "config.yaml");
    const stamp = await fileStamp(profileFile);
    const status = classifyProfileResult(await loadProfile(folder.uri.fsPath));
    if (controller.signal.aborted) {
      return;
    }
    if ((await fileStamp(profileFile)) !== stamp) {
      this.schedule(entry, REFRESH_DELAY_MS);
      return;
    }
    this.logger.info("profile-loaded", {
      folder: entry.index,
      status: status.kind,
      problems: status.kind === "profile-invalid" ? status.issues.length : 0,
    });
    if (status.kind !== "ready") {
      entry.contentWatcher?.watcher.dispose();
      delete entry.contentWatcher;
      finish(emptyModel(folder, status, displayLocale));
      return;
    }

    const { profile } = status;
    const contentLocale = selectLocale(profile.locale ?? vscode.env.language);
    const root = profile.content.root;
    const contentUri =
      root === "." ? folder.uri : vscode.Uri.joinPath(folder.uri, ...root.split("/"));
    this.watchContent(entry, contentUri);

    const scan = await scanPages({
      workspaceRoot: folder.uri.fsPath,
      contentRoot: root,
      scope: createContentScope(profile.content),
      cache: entry.cache,
      signal: controller.signal,
    });
    if (!scan.ok) {
      if (scan.reason !== "cancelled") {
        const failed: FolderStatus =
          scan.reason === "unreadable"
            ? { kind: "scan-failed" }
            : { kind: "content-root-invalid", problem: scan.reason, root };
        this.logger.warn("pages-scanned", { folder: entry.index, status: failed.kind });
        finish(emptyModel(folder, failed, contentLocale));
      }
      return;
    }
    this.logger.info("pages-scanned", {
      folder: entry.index,
      pages: scan.pages.length,
      truncated: scan.truncated,
    });
    finish({
      folder,
      status,
      contentLocale,
      pages: scan.pages,
      truncated: scan.truncated,
      contentRoot: contentUri,
    });
  }
}

function emptyModel(
  folder: vscode.WorkspaceFolder,
  status: FolderStatus,
  contentLocale: Locale,
): FolderModel {
  return { folder, status, contentLocale, pages: [], truncated: false };
}
