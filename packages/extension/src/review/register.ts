import * as vscode from "vscode";
import type { Translate } from "../core/i18n";
import type { Logger } from "../core/logger";
import type { FolderRegistry } from "../folders/folder-registry";
import { COMMIT_COMMAND, CommitService } from "../git/commit-service";
import type { GitAdapter } from "../git/git-adapter";
import { RepositoryContext } from "../git/repository-context";
import {
  OPEN_REVIEW_COMMAND,
  ReviewStatusBar,
  ReviewStore,
  SHOW_COMMIT_FINDINGS_COMMAND,
  VERIFY_COMMIT_COMMAND,
} from "./review-status";
import { SUBMIT_COMMAND, SubmitService } from "./submit-service";

export interface ReviewFeature {
  readonly commits: CommitService;
  readonly submissions: SubmitService;
  readonly store: ReviewStore;
  readonly statusBar: ReviewStatusBar;
}

/**
 * Commit, Check Commit, and Submit for review (specification §12), with the review status bar
 * item that follows the repository of the page the author works on.
 */
export function registerReview(
  subscriptions: vscode.Disposable[],
  deps: {
    readonly registry: FolderRegistry;
    readonly git: GitAdapter;
    readonly memento: vscode.Memento;
    readonly translate: Translate;
    readonly logger: Logger;
    /** The folder of the page the author is working on, if any. */
    readonly activeFolder: () => vscode.WorkspaceFolder | undefined;
  },
): ReviewFeature {
  const { registry, git, translate, logger } = deps;
  const store = new ReviewStore(deps.memento);
  const repositories = new RepositoryContext(registry, git, translate, deps.activeFolder);
  const commits = new CommitService(repositories, git, store, translate, logger);
  const submissions = new SubmitService(repositories, store, translate, logger);
  const statusBar = new ReviewStatusBar(store, translate, () => repositories.current());
  const updateStatus = (): void => {
    void statusBar.update();
  };

  subscriptions.push(
    store,
    statusBar,
    store.onDidChange(updateStatus),
    registry.onDidChange(updateStatus),
    git.onDidChangeRepository(updateStatus),
    vscode.window.onDidChangeActiveTextEditor(updateStatus),
    vscode.window.tabGroups.onDidChangeTabs(updateStatus),
    vscode.commands.registerCommand(COMMIT_COMMAND, () => commits.commit()),
    vscode.commands.registerCommand(VERIFY_COMMIT_COMMAND, () => commits.verify()),
    vscode.commands.registerCommand(SHOW_COMMIT_FINDINGS_COMMAND, () =>
      commits.showBlockedFindings(),
    ),
    vscode.commands.registerCommand(SUBMIT_COMMAND, () => submissions.submit()),
    vscode.commands.registerCommand(OPEN_REVIEW_COMMAND, (url: unknown) => {
      if (typeof url === "string" && url.startsWith("https://")) {
        void vscode.env.openExternal(vscode.Uri.parse(url));
      }
    }),
  );
  return { commits, submissions, store, statusBar };
}
