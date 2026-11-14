import * as vscode from "vscode";
import type { CheckResult, Finding } from "@lorequill/checks";
import type { Translate } from "../core/i18n";
import { blocksSubmit, parseReviewState, type ReviewState } from "../core/git/review-state";

const STATE_KEY = "lorequill.reviewStates";
const REVIEWS_KEY = "lorequill.reviews";

/** The submitted review of a branch, for the status bar link. */
export interface ReviewLink {
  readonly number: number;
  readonly url: string;
}

/** The repository and branch the author works in. */
export interface ReviewContext {
  readonly root: vscode.Uri;
  readonly branch?: string | undefined;
}

/** The last commit check that blocked a commit, kept in memory only. */
export interface BlockedCheck {
  readonly folder: vscode.WorkspaceFolder;
  readonly result: CheckResult;
}

/**
 * Review states per repository root (specification §12). A state is persisted in the workspace
 * state, so **Commit not verified** survives a restart and keeps blocking Submit.
 */
export class ReviewStore implements vscode.Disposable {
  private readonly emitter = new vscode.EventEmitter<void>();
  private readonly blocked = new Map<string, BlockedCheck>();

  readonly onDidChange = this.emitter.event;

  constructor(private readonly memento: vscode.Memento) {}

  state(root: vscode.Uri): ReviewState | undefined {
    return parseReviewState(this.all()[root.toString()]);
  }

  async setState(root: vscode.Uri, state: ReviewState): Promise<void> {
    this.blocked.delete(root.toString());
    await this.memento.update(STATE_KEY, { ...this.all(), [root.toString()]: state });
    this.emitter.fire();
  }

  /** The review submitted from `branch` of the repository at `root`, if known. */
  review(root: vscode.Uri, branch: string): ReviewLink | undefined {
    const value = this.reviews()[`${root.toString()}#${branch}`];
    if (typeof value !== "object" || value === null) {
      return undefined;
    }
    const { number, url } = value as Record<string, unknown>;
    return typeof number === "number" && typeof url === "string" && url.startsWith("https://")
      ? { number, url }
      : undefined;
  }

  async setReview(root: vscode.Uri, branch: string, review: ReviewLink): Promise<void> {
    await this.memento.update(REVIEWS_KEY, {
      ...this.reviews(),
      [`${root.toString()}#${branch}`]: { number: review.number, url: review.url },
    });
    this.emitter.fire();
  }

  /** Submit is blocked for the repository at `root`. */
  blocksSubmit(root: vscode.Uri): boolean {
    return blocksSubmit(this.state(root));
  }

  blockedCheck(root: vscode.Uri): BlockedCheck | undefined {
    return this.blocked.get(root.toString());
  }

  setBlockedCheck(root: vscode.Uri, check: BlockedCheck | undefined): void {
    if (check) {
      this.blocked.set(root.toString(), check);
    } else {
      this.blocked.delete(root.toString());
    }
    this.emitter.fire();
  }

  dispose(): void {
    this.emitter.dispose();
  }

  private reviews(): Record<string, unknown> {
    const value = this.memento.get<unknown>(REVIEWS_KEY);
    return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
  }

  private all(): Record<string, unknown> {
    const value = this.memento.get<unknown>(STATE_KEY);
    return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
  }
}

export const VERIFY_COMMIT_COMMAND = "lorequill.verifyCommit";
export const SHOW_COMMIT_FINDINGS_COMMAND = "lorequill.showCommitFindings";
export const OPEN_REVIEW_COMMAND = "lorequill.openReview";

/**
 * The Lorequill status bar item (specification §12): the review state of the repository the
 * author works in, separate from the document save state. Branch and pending changes stay in VS
 * Code's own Git status bar item. Hidden while there is nothing to report.
 */
export class ReviewStatusBar implements vscode.Disposable {
  private readonly item = vscode.window.createStatusBarItem(
    "lorequill.review",
    vscode.StatusBarAlignment.Left,
    10,
  );

  private shown = false;

  constructor(
    private readonly store: ReviewStore,
    private readonly translate: Translate,
    /** The repository and branch of the current context, if any. */
    private readonly currentContext: () => Promise<ReviewContext | undefined>,
  ) {
    this.item.name = translate("review.statusName");
  }

  async update(): Promise<void> {
    const context = await this.currentContext();
    const root = context?.root;
    const state = root && this.store.state(root);
    const blocked = root && this.store.blockedCheck(root);
    const review = root && context.branch ? this.store.review(root, context.branch) : undefined;
    const item = this.item;
    item.backgroundColor = undefined;
    item.command = undefined;
    if (blocked) {
      item.text = `$(error) ${this.translate("review.checkFailed", {
        findings: blocked.result.findings.length,
      })}`;
      item.tooltip = this.translate("review.checkFailedTooltip");
      item.backgroundColor = new vscode.ThemeColor("statusBarItem.errorBackground");
      item.command = SHOW_COMMIT_FINDINGS_COMMAND;
    } else if (state?.kind === "unverified") {
      item.text = `$(warning) ${this.translate("review.unverified")}`;
      item.tooltip = this.translate("review.unverifiedTooltip", {
        commit: state.commit.slice(0, 7),
      });
      item.backgroundColor = new vscode.ThemeColor("statusBarItem.warningBackground");
      item.command = VERIFY_COMMIT_COMMAND;
    } else if (state?.kind === "verification-failed") {
      item.text = `$(error) ${this.translate("review.unverified")}`;
      item.tooltip = this.translate("review.verificationFailedTooltip", {
        commit: state.commit.slice(0, 7),
        findings: state.findings,
      });
      item.backgroundColor = new vscode.ThemeColor("statusBarItem.errorBackground");
      item.command = VERIFY_COMMIT_COMMAND;
    } else if (review) {
      item.text = `$(git-pull-request) ${this.translate("review.link", { number: review.number })}`;
      item.tooltip = this.translate("review.linkTooltip", { url: review.url });
      item.command = { title: item.text, command: OPEN_REVIEW_COMMAND, arguments: [review.url] };
    } else if (state?.kind === "verified") {
      item.text = `$(pass) ${this.translate("review.verified")}`;
      item.tooltip = this.translate("review.verifiedTooltip", { commit: state.commit.slice(0, 7) });
    } else {
      item.hide();
      this.shown = false;
      return;
    }
    item.show();
    this.shown = true;
  }

  /** What the item shows, for tests. */
  probe(): { readonly visible: boolean; readonly text: string; readonly command?: string } {
    const command = this.item.command;
    const id = typeof command === "string" ? command : command?.command;
    return {
      visible: this.shown,
      text: this.item.text,
      ...(id === undefined ? {} : { command: id }),
    };
  }

  dispose(): void {
    this.item.dispose();
  }
}

/** Opens a finding of a repository-level check in the working-tree file at its line. */
export async function showFindings(
  folder: vscode.WorkspaceFolder,
  findings: readonly Finding[],
  title: string,
  describe: (finding: Finding) => string,
): Promise<void> {
  const picked = await vscode.window.showQuickPick(
    findings.map((finding) => ({
      label: describe(finding),
      description: `${finding.path}:${String(finding.line)}`,
      finding,
    })),
    { title, matchOnDescription: true },
  );
  if (!picked) {
    return;
  }
  const { finding } = picked;
  const line = Math.max(0, finding.line - 1);
  const column = Math.max(0, (finding.column ?? 1) - 1);
  await vscode.window.showTextDocument(
    vscode.Uri.joinPath(folder.uri, ...finding.path.split("/")),
    { selection: new vscode.Range(line, column, line, column) },
  );
}
