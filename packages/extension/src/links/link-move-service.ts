import { originalPath, rewriteLinksForMoves, type PathMove } from "@lorequill/markdown";
import { createContentScope, type Profile } from "@lorequill/profile";
import * as vscode from "vscode";
import type { Translate } from "../core/i18n";
import type { Logger } from "../core/logger";
import type { FolderRegistry } from "../folders/folder-registry";
import { pathInside } from "../folders/uri-paths";

export const UPDATE_LINKS_SETTING = "links.updateOnMove";

/** One page whose links change, with the edits in its current text. */
interface PageUpdate {
  readonly uri: vscode.Uri;
  readonly document: vscode.TextDocument;
  readonly edits: readonly { start: number; end: number; newText: string }[];
}

/**
 * Keeps relative links working when pages, assets, or directories below a content root are moved
 * or renamed in VS Code (Explorer, drag and drop, or another extension's workspace edit): every
 * page that links to a moved file, and every moved page's own relative links, is updated and
 * saved. Pages with unsaved changes are updated but left unsaved. Moves done outside VS Code
 * (for example `git mv`) are not seen; the `relative-links` check reports what they break.
 */
export class LinkMoveService implements vscode.Disposable {
  private readonly subscription: vscode.Disposable;
  /** Updates run one after another, so a quick second move sees the first one saved. */
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly registry: FolderRegistry,
    private readonly translate: Translate,
    private readonly logger: Logger,
  ) {
    this.subscription = vscode.workspace.onDidRenameFiles((event) => {
      this.queue = this.queue
        .then(() => this.update(event.files))
        .catch(() => {
          this.logger.warn("link-update", { result: "failed" });
        });
    });
  }

  dispose(): void {
    this.subscription.dispose();
  }

  /** Updates the links for renamed files; resolves with the number of pages changed. */
  async update(files: readonly { oldUri: vscode.Uri; newUri: vscode.Uri }[]): Promise<number> {
    if (!this.registry.trusted) {
      return 0;
    }
    let changed = 0;
    for (const model of this.registry.models()) {
      const root = model.contentRoot;
      if (
        model.status.kind !== "ready" ||
        !root ||
        !vscode.workspace
          .getConfiguration("lorequill", model.folder.uri)
          .get<boolean>(UPDATE_LINKS_SETTING, true)
      ) {
        continue;
      }
      const moves = files.flatMap(({ oldUri, newUri }) => {
        const from = pathInside(root, oldUri);
        const to = pathInside(root, newUri);
        return from === undefined || to === undefined || from === "" || to === "" || from === to
          ? []
          : [{ from, to }];
      });
      if (moves.length > 0) {
        changed += await this.updateFolder(model.status.profile, root, moves);
      }
    }
    if (changed > 0) {
      void vscode.window.showInformationMessage(
        this.translate("links.updatedOnMove", { count: changed }),
      );
    }
    return changed;
  }

  private async updateFolder(
    profile: Profile,
    root: vscode.Uri,
    moves: readonly PathMove[],
  ): Promise<number> {
    // The pages as they are now; each one's path before the move follows from the moves. The
    // Pages view's list is not used: its rescan may already have run, or not yet.
    const scope = createContentScope(profile.content);
    const files = await vscode.workspace.findFiles(
      new vscode.RelativePattern(root, "**/*.md"),
      new vscode.RelativePattern(root, "**/{.git,node_modules}/**"),
    );
    const updates: PageUpdate[] = [];
    for (const uri of files) {
      const now = pathInside(root, uri);
      if (now === undefined || !scope.isIncluded(now)) {
        continue;
      }
      const before = originalPath(now, moves);
      if (now === before && !mentionsAny(await this.peek(uri), moves)) {
        continue;
      }
      let document: vscode.TextDocument;
      try {
        document = await vscode.workspace.openTextDocument(uri);
      } catch {
        continue;
      }
      const edits = rewriteLinksForMoves(document.getText(), before, moves);
      if (edits.length > 0) {
        updates.push({ uri, document, edits });
      }
    }
    if (updates.length === 0) {
      return 0;
    }
    const unsaved = new Set(
      updates.filter(({ document }) => document.isDirty).map(({ uri }) => uri.toString()),
    );
    const edit = new vscode.WorkspaceEdit();
    for (const { uri, document, edits } of updates) {
      for (const { start, end, newText } of edits) {
        edit.replace(
          uri,
          new vscode.Range(document.positionAt(start), document.positionAt(end)),
          newText,
        );
      }
    }
    if (!(await vscode.workspace.applyEdit(edit))) {
      this.logger.warn("link-update", { result: "failed" });
      return 0;
    }
    for (const { uri, document } of updates) {
      if (!unsaved.has(uri.toString())) {
        await document.save();
      }
    }
    this.logger.info("link-update", { pages: updates.length, moves: moves.length });
    return updates.length;
  }

  /** The text of a page, from an open document or from disk; empty if it cannot be read. */
  private async peek(uri: vscode.Uri): Promise<string> {
    const open = vscode.workspace.textDocuments.find(
      (document) => document.uri.toString() === uri.toString(),
    );
    if (open) {
      return open.getText();
    }
    try {
      return new TextDecoder().decode(await vscode.workspace.fs.readFile(uri));
    } catch {
      return "";
    }
  }
}

/**
 * A cheap filter before parsing: whether the text contains the last segment of a moved path,
 * as written or percent-encoded. Pages without it cannot link to the moved files.
 */
function mentionsAny(text: string, moves: readonly PathMove[]): boolean {
  return moves.some(({ from }) => {
    const name = from.slice(from.lastIndexOf("/") + 1);
    return text.includes(name) || text.includes(encodeURIComponent(name));
  });
}
