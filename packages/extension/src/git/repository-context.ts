import type { Profile } from "@lorequill/profile";
import * as vscode from "vscode";
import type { MessageKey, Translate } from "../core/i18n";
import type { FolderModel, FolderRegistry } from "../folders/folder-registry";
import type { GitAdapter, RepositoryBinding } from "./git-adapter";
import type { GitRepository } from "./git-api";
import type { ReviewContext } from "../review/review-status";

/** A folder with a valid profile, bound to the Git repository that holds its content root. */
export interface BoundFolder {
  readonly model: FolderModel;
  readonly profile: Profile;
  readonly binding: RepositoryBinding;
}

/**
 * Which folder and repository a Git action works on (specification §12): the folder of the page
 * the author is working on, the only folder with a valid profile, or the one the author chooses.
 * Shared by Commit, Check Commit, Submit, and the review status bar.
 */
export class RepositoryContext {
  /** The repository of the last Git action, shown when no page is active. */
  private lastRepository: GitRepository | undefined;

  constructor(
    private readonly registry: FolderRegistry,
    private readonly git: GitAdapter,
    private readonly translate: Translate,
    /** The folder of the page the author is working on, if any. */
    private readonly activeFolder: () => vscode.WorkspaceFolder | undefined,
  ) {}

  /** The repository and branch of the current context, without asking. */
  async current(): Promise<ReviewContext | undefined> {
    const model = this.contextModel();
    const binding = model && (await this.git.bind(model));
    const repository =
      binding && "repository" in binding ? binding.repository : this.lastRepository;
    return repository && { root: repository.rootUri, branch: repository.state.HEAD?.name };
  }

  /**
   * The folder named `name`, or the folder of the current context, or the one the author
   * chooses, bound to its repository. Explains why when there is none; `undefined` then.
   */
  async resolve(name?: string): Promise<BoundFolder | undefined> {
    const model = await this.choose(name);
    if (model?.status.kind !== "ready") {
      return undefined;
    }
    const binding = await this.git.bind(model);
    if (!("repository" in binding)) {
      void vscode.window.showWarningMessage(
        this.translate(`git.unavailable.${binding.kind}` as MessageKey),
      );
      return undefined;
    }
    this.lastRepository = binding.repository;
    return { model, profile: model.status.profile, binding };
  }

  private ready(): FolderModel[] {
    return this.registry.models().filter(({ status }) => status.kind === "ready");
  }

  private contextModel(): FolderModel | undefined {
    const ready = this.ready();
    const active = this.activeFolder();
    return (
      (active && ready.find(({ folder }) => folder.uri.toString() === active.uri.toString())) ??
      (ready.length === 1 ? ready[0] : undefined)
    );
  }

  private async choose(name?: string): Promise<FolderModel | undefined> {
    const ready = this.ready();
    if (name !== undefined) {
      return ready.find(({ folder }) => folder.name === name);
    }
    const context = this.contextModel();
    if (context) {
      return context;
    }
    if (ready.length === 0) {
      void vscode.window.showWarningMessage(this.translate("commit.noFolder"));
      return undefined;
    }
    const picked = await vscode.window.showQuickPick(
      ready.map((model) => ({ label: model.folder.name, model })),
      { title: this.translate("commit.chooseFolder") },
    );
    return picked?.model;
  }
}
