import type { CheckResult, Finding } from "@lorequill/checks";
import * as vscode from "vscode";
import { checkTree, commitChecked, type CheckTarget, type TreeCheck } from "../core/git/commit";
import {
  commitFlow,
  commitFlowResult,
  reviewStateAfterCommit,
  reviewStateAfterVerify,
  verifyFlow,
  verifyResult,
  type CommitFlowOutcome,
  type MessageRequest,
  type VerifyOutcome,
} from "../core/git/commit-flow";
import {
  defaultCommitMessage,
  type CommitFlowResult,
  type DialogEntry,
  type VerifyResult,
} from "../core/git/commit-plan";
import { hasStagedChanges, readHead } from "../core/git/repository";
import { localizeFinding } from "../core/findings";
import type { MessageKey, Translate } from "../core/i18n";
import type { Logger } from "../core/logger";
import type { GitAdapter } from "./git-adapter";
import type { BoundFolder, RepositoryContext } from "./repository-context";
import { showFindings, type ReviewStore } from "../review/review-status";

export const COMMIT_COMMAND = "lorequill.commit";

/** What `Commit` asks the author; replaced by scripted answers in integration tests. */
export interface CommitPrompts {
  /** The selected repository-relative paths; `undefined` when cancelled. */
  chooseFiles(
    entries: readonly DialogEntry[],
    branch: string,
    repositoryRoot: vscode.Uri,
  ): Promise<ReadonlySet<string> | undefined>;
  /** Confirms pre-staged files outside the content root. */
  confirmUnchecked(paths: readonly string[]): Promise<boolean>;
  askMessage(request: MessageRequest): Promise<string | undefined>;
}

/**
 * `Commit` and `Check Commit` in VS Code (specification §12, decision D25). The flows are
 * {@link commitFlow} and {@link verifyFlow}; this service binds them to the Git adapter, the
 * review store, and VS Code's dialogs, and reports their outcome.
 */
export class CommitService {
  constructor(
    private readonly repositories: RepositoryContext,
    private readonly git: GitAdapter,
    private readonly store: ReviewStore,
    private readonly translate: Translate,
    private readonly logger: Logger,
    private readonly prompts: CommitPrompts = new VsCodeCommitPrompts(translate),
  ) {}

  async commit(folder?: string, prompts: CommitPrompts = this.prompts): Promise<CommitFlowResult> {
    const bound = await this.repositories.resolve(folder);
    const result = bound ? commitFlowResult(await this.runCommit(bound, prompts)) : "unavailable";
    this.logger.info("commit", { result });
    return result;
  }

  /** Checks the tree of the current commit to clear **Commit not verified** (§12). */
  async verify(folder?: string): Promise<VerifyResult> {
    const bound = await this.repositories.resolve(folder);
    const result = bound ? verifyResult(await this.runVerify(bound)) : "unavailable";
    this.logger.info("verify-commit", { result });
    return result;
  }

  /** Shows the findings of the last blocked commit check of the current repository. */
  async showBlockedFindings(): Promise<void> {
    const root = (await this.repositories.current())?.root;
    const blocked = root && this.store.blockedCheck(root);
    if (blocked) {
      await this.presentFindings(blocked.folder, blocked.result, "commit.findingsTitleStaged");
    }
  }

  private async runCommit(bound: BoundFolder, prompts: CommitPrompts): Promise<CommitFlowOutcome> {
    const { model, binding } = bound;
    const repository = binding.repository;
    const root = repository.rootUri;
    const absolute = (paths: readonly string[]): vscode.Uri[] =>
      paths.map((path) => vscode.Uri.joinPath(root, ...path.split("/")));
    await repository.status();
    const outcome = await commitFlow(
      {
        head: await readHead(binding.git),
        conflicted: repository.state.mergeChanges.length > 0,
        files: this.git.changedFiles(binding),
        contentPrefix: binding.prefix,
        defaultMessage: defaultCommitMessage(model.contentLocale),
      },
      {
        chooseFiles: (entries, branch) => prompts.chooseFiles(entries, branch, root),
        confirmUnchecked: (paths) => prompts.confirmUnchecked(paths),
        stage: async (paths) => {
          await this.git.stage(model, absolute(paths));
        },
        unstage: async (paths) => {
          await this.git.unstage(model, absolute(paths));
        },
        hasStagedChanges: () => hasStagedChanges(binding.git),
        check: () =>
          this.withProgress("commit.checking", (signal) =>
            checkTree(binding.git, { kind: "index" }, targetOf(bound), signal),
          ),
        recordCheck: (result) => {
          this.store.setBlockedCheck(
            root,
            result.status === "passed" ? undefined : { folder: model.folder, result },
          );
        },
        askMessage: (request) => prompts.askMessage(request),
        commit: async (message, checked) => {
          const outcome = await commitChecked(binding.git, message, checked);
          await repository.status();
          return outcome;
        },
      },
    );
    const state = reviewStateAfterCommit(outcome);
    if (state) {
      await this.store.setState(root, state);
    }
    this.reportCommit(outcome, bound);
    return outcome;
  }

  private async runVerify(bound: BoundFolder): Promise<VerifyOutcome> {
    const { binding } = bound;
    const outcome = await verifyFlow(await readHead(binding.git), (commit) =>
      this.withProgress("commit.verifying", (signal) =>
        checkTree(binding.git, { kind: "commit", commit }, targetOf(bound), signal),
      ),
    );
    const state = reviewStateAfterVerify(outcome);
    if (state) {
      await this.store.setState(binding.repository.rootUri, state);
    }
    this.reportVerify(outcome, bound);
    return outcome;
  }

  private reportCommit(outcome: CommitFlowOutcome, bound: BoundFolder): void {
    switch (outcome.kind) {
      case "detached":
        void vscode.window.showErrorMessage(this.translate("commit.detached"));
        return;
      case "conflicted":
        void vscode.window.showErrorMessage(this.translate("commit.conflicted"));
        return;
      case "nothing-to-commit":
        void vscode.window.showInformationMessage(
          this.translate(
            outcome.reason === "no-changes" ? "commit.noChanges" : "commit.emptySelection",
          ),
        );
        return;
      case "cancelled":
        return;
      case "unchecked":
        this.explainUnchecked(outcome.check);
        return;
      case "check-blocked": {
        const result = outcome.result;
        if (result.status === "error") {
          this.explainUnchecked({ kind: "error", result });
          return;
        }
        this.offerFindings(
          this.translate("commit.checkFailed", { findings: result.findings.length }),
          bound,
          result,
          "commit.findingsTitleStaged",
        );
        return;
      }
      case "changed":
        void vscode.window.showWarningMessage(this.translate("commit.changed"));
        return;
      case "failed": {
        const detail = outcome.stderr.trim().slice(0, 2000);
        // Hook output can explain the failure; it is shown, never logged.
        void vscode.window.showErrorMessage(
          this.translate("commit.failed", { code: outcome.exitCode }),
          detail === "" ? {} : { modal: true, detail },
        );
        return;
      }
      case "committed": {
        const commit = outcome.commit.slice(0, 7);
        if (outcome.verified) {
          void vscode.window.showInformationMessage(
            this.translate("commit.done", { commit, branch: outcome.branch }),
          );
          return;
        }
        const verify = this.translate("commit.verifyNow");
        void vscode.window
          .showWarningMessage(this.translate("commit.unverified", { commit }), verify)
          .then((choice) => {
            if (choice === verify) {
              void this.verify(bound.model.folder.name);
            }
          });
        return;
      }
    }
  }

  private reportVerify(outcome: VerifyOutcome, bound: BoundFolder): void {
    if (outcome.kind === "verified") {
      void vscode.window.showInformationMessage(
        this.translate("commit.verified", { commit: outcome.commit.slice(0, 7) }),
      );
    } else if (outcome.kind === "verification-failed") {
      const check = outcome.check;
      if (check.kind === "checked" && check.result.status === "failed") {
        this.offerFindings(
          this.translate("commit.verificationFailed", {
            findings: check.result.findings.length,
          }),
          bound,
          check.result,
          "commit.findingsTitleCommit",
        );
      } else {
        this.explainUnchecked(
          check.kind === "checked" ? { kind: "error", result: check.result } : check,
        );
      }
    }
  }

  private offerFindings(
    message: string,
    bound: BoundFolder,
    result: CheckResult,
    titleKey: MessageKey,
  ): void {
    const show = this.translate("commit.showFindings");
    void vscode.window.showWarningMessage(message, show).then((choice) => {
      if (choice === show) {
        void this.presentFindings(bound.model.folder, result, titleKey);
      }
    });
  }

  private explainUnchecked(
    check: Exclude<TreeCheck, { kind: "checked" }> | { kind: "error"; result: CheckResult },
  ): void {
    if (check.kind === "conflicted") {
      void vscode.window.showErrorMessage(this.translate("commit.conflicted"));
    } else if (check.kind === "invalid-profile") {
      void vscode.window.showErrorMessage(this.translate("commit.invalidProfile"));
    } else {
      void vscode.window.showErrorMessage(
        this.translate("commit.checkIncomplete", { reason: check.result.error?.code ?? "error" }),
      );
    }
  }

  private async presentFindings(
    folder: vscode.WorkspaceFolder,
    result: CheckResult,
    titleKey: MessageKey,
  ): Promise<void> {
    await showFindings(
      folder,
      result.findings,
      this.translate(titleKey, { findings: result.findings.length }),
      (finding: Finding) =>
        localizeFinding(this.translate, finding.code, finding.params, finding.message),
    );
  }

  private withProgress<T>(
    titleKey: MessageKey,
    task: (signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    return Promise.resolve(
      vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: this.translate(titleKey),
          cancellable: true,
        },
        (_progress, token) => {
          const controller = new AbortController();
          token.onCancellationRequested(() => {
            controller.abort();
          });
          return task(controller.signal);
        },
      ),
    );
  }
}

function targetOf({ binding, profile }: BoundFolder): CheckTarget {
  return {
    folderPrefix: binding.folderPrefix,
    contentPrefix: binding.prefix,
    workingProfile: profile,
  };
}

/** The commit dialogs as VS Code shows them. */
export class VsCodeCommitPrompts implements CommitPrompts {
  constructor(private readonly translate: Translate) {}

  chooseFiles(
    entries: readonly DialogEntry[],
    branch: string,
    repositoryRoot: vscode.Uri,
  ): Promise<ReadonlySet<string> | undefined> {
    const diff: vscode.QuickInputButton = {
      iconPath: new vscode.ThemeIcon("diff"),
      tooltip: this.translate("commit.openDiff"),
    };
    const items = entries.map((entry) => ({
      label: entry.file.path,
      description: this.describeEntry(entry),
      picked: entry.picked,
      buttons: [diff],
      entry,
    }));
    const pick = vscode.window.createQuickPick<(typeof items)[number]>();
    pick.title = this.translate("commit.dialogTitle", { branch });
    pick.placeholder = this.translate("commit.dialogPlaceholder");
    pick.canSelectMany = true;
    pick.matchOnDescription = true;
    pick.ignoreFocusOut = true;
    pick.items = items;
    pick.selectedItems = items.filter(({ picked }) => picked);
    return new Promise((resolve) => {
      let accepted = false;
      pick.onDidTriggerItemButton(({ item }) => {
        void vscode.commands.executeCommand(
          "git.openChange",
          vscode.Uri.joinPath(repositoryRoot, ...item.entry.file.path.split("/")),
        );
      });
      pick.onDidAccept(() => {
        accepted = true;
        resolve(new Set(pick.selectedItems.map(({ entry }) => entry.file.path)));
        pick.hide();
      });
      pick.onDidHide(() => {
        if (!accepted) {
          resolve(undefined);
        }
        pick.dispose();
      });
      pick.show();
    });
  }

  async confirmUnchecked(paths: readonly string[]): Promise<boolean> {
    const include = this.translate("commit.includeAnyway");
    return (
      (await vscode.window.showWarningMessage(
        this.translate("commit.confirmUnrelated", { count: paths.length }),
        { modal: true, detail: paths.join("\n") },
        include,
      )) === include
    );
  }

  async askMessage(request: MessageRequest): Promise<string | undefined> {
    return vscode.window.showInputBox({
      title: this.translate("commit.messageTitle", { branch: request.branch }),
      prompt: this.translate(
        request.profileSource === "tree" ? "commit.messagePrompt" : "commit.messagePromptUntracked",
        { pages: request.pagesChecked },
      ),
      value: request.defaultMessage,
      validateInput: (value) =>
        value.trim() === "" ? this.translate("commit.messageEmpty") : undefined,
    });
  }

  private describeEntry(entry: DialogEntry): string {
    const marks: string[] = [];
    if (entry.partiallyStaged) {
      marks.push(this.translate("commit.mark.partial"));
    } else if (entry.preStaged) {
      marks.push(this.translate("commit.mark.staged"));
    }
    if (entry.file.untracked) {
      marks.push(this.translate("commit.mark.new"));
    }
    if (entry.outsideContentRoot) {
      marks.push(this.translate("commit.mark.unchecked"));
    }
    return marks.join(" · ");
  }
}
