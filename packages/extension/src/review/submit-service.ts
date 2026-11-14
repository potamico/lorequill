import * as vscode from "vscode";
import { branchNameFrom, isValidBranchName } from "../core/git/branch-name";
import type { GitBinary } from "../core/git/git-process";
import {
  commitsSince,
  hasStagedChanges,
  readHead,
  resetBranchToRemote,
} from "../core/git/repository";
import { GitHubHost, gitHubTargetFor } from "../core/host/github";
import type { HostError, ReviewHost } from "../core/host/review-host";
import {
  PushError,
  submit,
  submitLogCode,
  type PushFailure,
  type CommitSummary,
  type RemoteFacts,
  type SubmitOutcome,
  type SubmitPlan,
  type SubmitPorts,
} from "../core/host/submit";
import type { MessageKey, Translate } from "../core/i18n";
import type { Logger } from "../core/logger";
import type { RepositoryBinding } from "../git/git-adapter";
import type { RepositoryContext } from "../git/repository-context";
import type { ReviewStore } from "./review-status";

export const SUBMIT_COMMAND = "lorequill.submit";

/** What `Submit for Review` asks the author; replaced by scripted answers in tests. */
export interface SubmitPrompts {
  /** The remote to submit to, among several; `undefined` when cancelled. */
  chooseRemote(remotes: readonly RemoteFacts[]): Promise<string | undefined>;
  /** Shows the plan; the review title, or `undefined` when cancelled. */
  confirm(plan: SubmitPlan): Promise<{ readonly title: string } | undefined>;
  /**
   * On the base branch: explains that changes are submitted from their own branch and asks for
   * its name, starting from `suggestion`. `check` returns why a name cannot be used. `undefined`
   * when declined.
   */
  branchName(
    base: string,
    suggestion: string,
    check: (name: string) => Promise<string | undefined>,
  ): Promise<string | undefined>;
}

/** Resolves the review host of a remote; replaced by a mock host in tests. */
export type HostResolver = (
  remote: RemoteFacts,
  binding: RepositoryBinding,
) => ReviewHost | undefined;

/** Lines of the commit list in the confirmation; the rest is summarized. */
const SHOWN_COMMITS = 15;

/**
 * `Submit for Review` (specification §12, §13) in VS Code: the GitHub host signs in through
 * VS Code's `github` or `github-enterprise` authentication provider only when a remote operation
 * is needed; fetch and push run through the Git extension, so the author's Git credentials and
 * VS Code's prompts apply. The flow itself is {@link submit}.
 */
export class SubmitService {
  /** Ask for a new GitHub session on the next attempt, after the token was rejected. */
  private forceNewSession = false;
  private hostOverride: HostResolver | undefined;

  constructor(
    private readonly repositories: RepositoryContext,
    private readonly store: ReviewStore,
    private readonly translate: Translate,
    private readonly logger: Logger,
    private readonly prompts: SubmitPrompts = new VsCodeSubmitPrompts(translate),
  ) {}

  /** Replaces host resolution, for integration tests with a mock host. */
  setHostResolver(resolver: HostResolver | undefined): void {
    this.hostOverride = resolver;
  }

  async submit(
    folder?: string,
    prompts: SubmitPrompts = this.prompts,
  ): Promise<SubmitOutcome | undefined> {
    const bound = await this.repositories.resolve(folder);
    if (!bound) {
      return undefined;
    }
    const { binding, profile } = bound;
    const repository = binding.repository;
    await repository.status();
    const state = repository.state;
    const head = await readHead(binding.git);
    const outcome = await submit(
      {
        head,
        baseBranch: profile.review?.base_branch,
        reviewBlocked: this.store.blocksSubmit(repository.rootUri),
        conflicted: state.mergeChanges.length > 0,
        stagedChanges: await hasStagedChanges(binding.git),
        remotes: state.remotes.flatMap(({ name, pushUrl, fetchUrl }) => {
          const url = pushUrl ?? fetchUrl;
          return url === undefined ? [] : [{ name, url }];
        }),
        upstreamRemote: state.HEAD?.upstream?.remote,
      },
      this.ports(binding, prompts),
    );
    await repository.status();
    this.logger.info("submit", { result: submitLogCode(outcome) });
    if (outcome.kind === "submitted" && head.kind === "branch") {
      await this.store.setReview(repository.rootUri, head.branch, outcome.review);
    }
    this.report(outcome);
    return outcome;
  }

  private ports(binding: RepositoryBinding, prompts: SubmitPrompts): SubmitPorts {
    const repository = binding.repository;
    return {
      chooseRemote: (remotes) => prompts.chooseRemote(remotes),
      hostFor: (remote) =>
        this.hostOverride ? this.hostOverride(remote, binding) : this.gitHubHost(remote),
      fetchBase: async (remote, base) => {
        try {
          await repository.fetch(remote, base);
        } catch (error) {
          throw pushErrorOf(error);
        }
      },
      commitsSince: (remote, base) => commitsSince(binding.git, remote, base),
      confirm: (plan) => prompts.confirm(plan),
      push: async (remote, branch, setUpstream) => {
        try {
          await repository.push(remote, branch, setUpstream);
        } catch (error) {
          throw pushErrorOf(error);
        }
      },
      branchOff: async (remote, base, commits) => {
        const tip = await readHead(binding.git);
        const name = await prompts.branchName(
          base,
          await this.suggestBranch(binding.git, commits),
          (candidate) => this.branchNameProblem(binding.git, base, candidate),
        );
        if (name === undefined) {
          return undefined;
        }
        try {
          await repository.createBranch(name, true);
        } catch (error) {
          const detail =
            typeof error === "object" && error !== null && "stderr" in error
              ? String(error.stderr).trim().slice(0, 2000)
              : "";
          void vscode.window.showErrorMessage(
            this.translate("submit.branch.failed", { branch: name }),
            detail === "" ? {} : { modal: true, detail },
          );
          return undefined;
        }
        // The base branch's own commits are on the new branch now; without them it follows the
        // remote again, so pulling after the review is merged never diverges.
        const moved =
          tip.kind === "branch" &&
          tip.branch === base &&
          (await resetBranchToRemote(binding.git, base, remote, name, tip.commit));
        this.logger.info("submit", { branchedOff: true, baseReset: moved });
        return name;
      },
    };
  }

  /** From the subject of a single commit, else from today's date; free in the repository. */
  private async suggestBranch(git: GitBinary, commits: readonly CommitSummary[]): Promise<string> {
    const [only] = commits;
    const now = new Date();
    const date = [now.getFullYear(), now.getMonth() + 1, now.getDate()]
      .map((part) => String(part).padStart(2, "0"))
      .join("-");
    const stem =
      (commits.length === 1 && only ? branchNameFrom(only.subject) : undefined) ??
      this.translate("submit.branch.suggestion", { date });
    for (let index = 1; index < 10; index++) {
      const candidate = index === 1 ? stem : `${stem}-${String(index)}`;
      if (!(await branchExists(git, candidate))) {
        return candidate;
      }
    }
    return stem;
  }

  private async branchNameProblem(
    git: GitBinary,
    base: string,
    name: string,
  ): Promise<string | undefined> {
    if (name === "") {
      return this.translate("submit.branch.empty");
    }
    if (!isValidBranchName(name)) {
      return this.translate("submit.branch.invalid");
    }
    if (name === base || (await branchExists(git, name))) {
      return this.translate("submit.branch.exists", { branch: name });
    }
    return undefined;
  }

  private gitHubHost(remote: RemoteFacts): ReviewHost | undefined {
    const enterprise = vscode.workspace.getConfiguration("github-enterprise").get<string>("uri");
    const target = gitHubTargetFor(remote.url, enterprise);
    if (!target) {
      return undefined;
    }
    return new GitHubHost(target, async () => {
      const forceNewSession = this.forceNewSession;
      this.forceNewSession = false;
      const session = forceNewSession
        ? await vscode.authentication.getSession(target.authProvider, ["repo"], {
            forceNewSession: true,
          })
        : await vscode.authentication.getSession(target.authProvider, ["repo"], {
            createIfNone: true,
          });
      return session.accessToken;
    });
  }

  private report(outcome: SubmitOutcome): void {
    const open = this.translate("submit.openReview");
    const offerOpen = (message: Thenable<string | undefined>, url: string): void => {
      void message.then((choice) => {
        if (choice === open) {
          void vscode.env.openExternal(vscode.Uri.parse(url));
        }
      });
    };
    switch (outcome.kind) {
      case "submitted":
        offerOpen(
          vscode.window.showInformationMessage(
            this.translate(outcome.created ? "submit.created" : "submit.updated", {
              number: outcome.review.number,
              host: outcome.host,
            }),
            open,
          ),
          outcome.review.url,
        );
        return;
      case "cancelled":
        return;
      case "blocked":
        void vscode.window.showWarningMessage(
          this.translate(`submit.blocked.${outcome.reason}` as MessageKey, {
            base: outcome.base ?? "",
          }),
        );
        return;
      case "closed-review":
        offerOpen(
          vscode.window.showWarningMessage(
            this.translate(
              outcome.review.state === "merged" ? "submit.reviewMerged" : "submit.reviewClosed",
              { number: outcome.review.number },
            ),
            open,
          ),
          outcome.review.url,
        );
        return;
      case "fetch-failed":
      case "push-failed":
        this.reportGitFailure(outcome.kind, outcome.failure, outcome.detail);
        return;
      case "host-failed":
        this.reportHostFailure(outcome.error, outcome.pushed);
        return;
    }
  }

  private reportGitFailure(
    stage: "fetch-failed" | "push-failed",
    failure: PushFailure,
    detail: string,
  ): void {
    const key =
      failure === "rejected"
        ? "submit.diverged"
        : `submit.${stage === "fetch-failed" ? "fetch" : "push"}.${failure}`;
    // Git's own output explains the failure; it is shown, never logged.
    const text = detail.trim().slice(0, 2000);
    void vscode.window.showErrorMessage(
      this.translate(key as MessageKey),
      text === "" ? {} : { modal: true, detail: text },
    );
  }

  private reportHostFailure(error: HostError, pushed: boolean): void {
    const retry = pushed ? ` ${this.translate("submit.pushedRetry")}` : "";
    if (error.kind === "auth") {
      const signIn = this.translate("submit.signInAgain");
      void vscode.window
        .showErrorMessage(`${this.translate("submit.host.auth")}${retry}`, signIn)
        .then((choice) => {
          if (choice === signIn) {
            this.forceNewSession = true;
            void vscode.commands.executeCommand(SUBMIT_COMMAND);
          }
        });
      return;
    }
    const message = `${this.translate(`submit.host.${error.kind}` as MessageKey)}${retry}`;
    void vscode.window.showErrorMessage(
      message,
      error.detail === "" ? {} : { modal: true, detail: error.detail.slice(0, 2000) },
    );
  }
}

async function branchExists(git: GitBinary, name: string): Promise<boolean> {
  const result = await git.run([
    "rev-parse",
    "-q",
    "--verify",
    "--end-of-options",
    `refs/heads/${name}`,
  ]);
  return result.exitCode === 0;
}

/** Maps a Git extension error to a push failure, by its documented `gitErrorCode`. */
function pushErrorOf(error: unknown): PushError {
  const record =
    typeof error === "object" && error !== null ? (error as Record<string, unknown>) : {};
  const code = typeof record.gitErrorCode === "string" ? record.gitErrorCode : "";
  const detail = typeof record.stderr === "string" ? record.stderr : "";
  if (code === "PushRejected" || /non-fast-forward|fetch first|\[rejected\]/i.test(detail)) {
    return new PushError("rejected", detail);
  }
  if (code === "AuthenticationFailed" || code === "PermissionDenied") {
    return new PushError("auth", detail);
  }
  if (code === "RemoteConnectionError" || code === "CantAccessRemote") {
    return new PushError("network", detail);
  }
  return new PushError("failed", detail);
}

/** The submission dialogs as VS Code shows them. */
export class VsCodeSubmitPrompts implements SubmitPrompts {
  constructor(private readonly translate: Translate) {}

  async chooseRemote(remotes: readonly RemoteFacts[]): Promise<string | undefined> {
    return (
      await vscode.window.showQuickPick(
        remotes.map(({ name, url }) => ({ label: name, description: url })),
        { title: this.translate("submit.chooseRemote") },
      )
    )?.label;
  }

  async branchName(
    base: string,
    suggestion: string,
    check: (name: string) => Promise<string | undefined>,
  ): Promise<string | undefined> {
    const create = this.translate("submit.branch.create");
    const choice = await vscode.window.showInformationMessage(
      this.translate("submit.branch.title", { base }),
      { modal: true, detail: this.translate("submit.branch.detail", { base }) },
      create,
    );
    if (choice !== create) {
      return undefined;
    }
    const name = await vscode.window.showInputBox({
      title: this.translate("submit.branch.namePrompt"),
      prompt: this.translate("submit.branch.nameHint"),
      value: suggestion,
      validateInput: (value) => check(value.trim()),
    });
    const trimmed = name?.trim();
    return trimmed === undefined || trimmed === "" ? undefined : trimmed;
  }

  /** Shows destination and commits; asks for the title of a new review. */
  async confirm(plan: SubmitPlan): Promise<{ readonly title: string } | undefined> {
    const lines = plan.commits
      .slice(0, SHOWN_COMMITS)
      .map(({ id, subject }) => `${id.slice(0, 7)}  ${subject}`);
    const more = plan.commits.length - SHOWN_COMMITS;
    if (more > 0 || plan.truncated) {
      lines.push(this.translate("submit.moreCommits", { count: Math.max(more, 1) }));
    }
    const detail = [
      this.translate("submit.destination", {
        host: plan.host,
        remote: plan.remote,
        branch: plan.branch,
        base: plan.base,
      }),
      plan.existing
        ? this.translate("submit.updateReview", {
            number: plan.existing.number,
            title: plan.existing.title,
          })
        : this.translate("submit.newReview"),
      "",
      this.translate("submit.commitsIntro", {
        count: plan.commits.length + (plan.truncated ? 1 : 0),
      }),
      ...lines,
      ...(plan.stagedChanges ? ["", this.translate("submit.stagedNotIncluded")] : []),
    ].join("\n");
    const go = this.translate("submit.confirm");
    const choice = await vscode.window.showInformationMessage(
      this.translate("submit.confirmTitle", { branch: plan.branch, base: plan.base }),
      { modal: true, detail },
      go,
    );
    if (choice !== go) {
      return undefined;
    }
    if (plan.existing) {
      return { title: plan.existing.title };
    }
    const title = await vscode.window.showInputBox({
      title: this.translate("submit.titlePrompt"),
      value: plan.defaultTitle,
      validateInput: (value) =>
        value.trim() === "" ? this.translate("submit.titleEmpty") : undefined,
    });
    return title === undefined || title.trim() === "" ? undefined : { title: title.trim() };
  }
}
