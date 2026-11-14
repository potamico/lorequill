import type { CheckPagesResult } from "@lorequill/server/protocol";
import type * as vscode from "vscode";
import type { CommitPrompts, CommitService } from "./git/commit-service";
import type { CommitFlowResult, VerifyResult } from "./core/git/commit-plan";
import { MockReviewHost } from "./core/host/mock-host";
import type { SubmitOutcome } from "./core/host/submit";
import type { Translate } from "./core/i18n";
import type { FolderRegistry } from "./folders/folder-registry";
import type { GitAdapter, GitProbe } from "./git/git-adapter";
import type { LinkService } from "./editor/link-service";
import { createPage, type NewPagePrompts } from "./pages/new-page-command";
import type { OutlineTreeProvider } from "./editor/outline-view";
import type { EditorSessionProbe, PageEditorProvider } from "./editor/page-editor";
import type { PagesTreeProvider } from "./pages/pages-view";
import type { PropertiesViewProvider } from "./properties/properties-view";
import type { ReviewStatusBar, ReviewStore } from "./review/review-status";
import type { SubmitPrompts, SubmitService } from "./review/submit-service";

/** Snapshot of one element of a tree view, for tests. */
export interface TreeSnapshot {
  readonly label: string;
  readonly description?: string;
  /** File system path of the item's resource, when it has one. */
  readonly resource?: string;
  /** Identifier of the command that runs when the item is selected. */
  readonly command?: string;
  readonly children: readonly TreeSnapshot[];
}

/** Scripted answers for `Commit`; a missing answer cancels at its prompt. */
export interface CommitAnswers {
  readonly folder?: string;
  /** Repository-relative paths to select in the dialog. */
  readonly select?: readonly string[];
  /** Confirms the inclusion of pre-staged files outside the content root. */
  readonly confirm?: boolean;
  readonly message?: string;
}

/** Scripted answers for `Submit for Review`; a missing answer cancels at its prompt. */
export interface SubmitAnswers {
  readonly folder?: string;
  readonly remote?: string;
  readonly confirm?: boolean;
  readonly title?: string;
  /** Name of the branch to create when submitting from the base branch. */
  readonly branch?: string;
}

/** Scripted answers for page creation; a missing answer cancels at its prompt. */
export interface NewPageAnswers {
  readonly title?: string;
  readonly fileName?: string;
  readonly collection?: string;
}

/**
 * What `activate` returns in VS Code's test mode only. This is an internal surface for the
 * extension's own integration tests, not a supported API for other extensions.
 */
export interface LorequillInternalApi {
  /** Labels and descriptions of the Pages tree as VS Code renders them. */
  readonly pagesTree: () => readonly TreeSnapshot[];
  readonly setPageFilter: (text: string) => void;
  /** Number of workspace folders whose profile was read; must stay 0 while untrusted. */
  readonly loadedFolderCount: () => number;
  /** Whether the language server process is running; must stay false while untrusted. */
  readonly languageServerRunning: () => boolean;
  /** Runs `Check Pages` without user interface; `undefined` when checks are unavailable. */
  readonly checkPages: () => Promise<CheckPagesResult | undefined>;
  /** Open Lorequill page editors. */
  readonly editorSessions: () => readonly EditorSessionProbe[];
  /** The page outline (`Outline`) of the active Lorequill editor, as VS Code renders it. */
  readonly outlineTree: () => readonly TreeSnapshot[];
  /** The Properties view (`Properties`). */
  readonly properties: PropertiesViewProvider;
  /** Insert Link and link completion. */
  readonly links: LinkService;
  /** The Git adapter by folder name: repository binding, status, staged snapshots, staging. */
  readonly git: GitProbe;
  /** Runs `Commit` with the given answers instead of prompts. */
  readonly commit: (answers: CommitAnswers) => Promise<CommitFlowResult>;
  /** Runs `Check Commit` for a folder. */
  readonly verifyCommit: (folder: string) => Promise<VerifyResult>;
  /** The review state of a folder's repository, and the status bar item. */
  readonly review: (folder: string) => Promise<{
    readonly state: string | undefined;
    readonly blocksSubmit: boolean;
    readonly status: {
      readonly visible: boolean;
      readonly text: string;
      readonly command?: string;
    };
  }>;
  /** Runs `Submit for Review` with the given answers instead of prompts. */
  readonly submit: (answers: SubmitAnswers) => Promise<SubmitOutcome | undefined>;
  /** Replaces the review host of every remote by a fresh mock host, which is returned. */
  readonly useMockHost: () => MockReviewHost;
  /** Creates a page like the plus action of a directory, with the given answers. */
  readonly createPage: (
    directory: string,
    answers: NewPageAnswers,
  ) => Promise<vscode.Uri | undefined>;
}

/** The parts of the running extension that the internal API exposes. */
export interface TestApiDependencies {
  readonly registry: FolderRegistry;
  readonly pages: PagesTreeProvider;
  readonly setPageFilter: (text: string) => void;
  readonly outline: OutlineTreeProvider;
  readonly pageEditor: PageEditorProvider;
  readonly properties: PropertiesViewProvider;
  readonly links: LinkService;
  readonly git: GitAdapter;
  readonly gitProbe: GitProbe;
  readonly commits: CommitService;
  readonly submissions: SubmitService;
  readonly reviewStore: ReviewStore;
  readonly reviewStatus: ReviewStatusBar;
  readonly translate: Translate;
  readonly languageServerRunning: () => boolean;
  readonly checkPages: () => Promise<CheckPagesResult | undefined>;
}

/** A tree provider whose children are available without waiting. */
interface SyncTreeProvider<T> {
  getTreeItem(element: T): vscode.TreeItem;
  getChildren(element?: T): readonly T[];
}

function snapshotOf<T>(provider: SyncTreeProvider<T>, elements: readonly T[]): TreeSnapshot[] {
  return elements.map((element) => {
    const item = provider.getTreeItem(element);
    const label = typeof item.label === "string" ? item.label : (item.label?.label ?? "");
    return {
      label,
      ...(typeof item.description === "string" ? { description: item.description } : {}),
      ...(item.resourceUri ? { resource: item.resourceUri.fsPath } : {}),
      ...(item.command ? { command: item.command.command } : {}),
      children: snapshotOf(provider, provider.getChildren(element)),
    };
  });
}

function commitPrompts(answers: CommitAnswers): CommitPrompts {
  return {
    chooseFiles: () => Promise.resolve(answers.select && new Set(answers.select)),
    confirmUnchecked: () => Promise.resolve(answers.confirm ?? false),
    askMessage: () => Promise.resolve(answers.message),
  };
}

function submitPrompts(answers: SubmitAnswers): SubmitPrompts {
  return {
    chooseRemote: () => Promise.resolve(answers.remote),
    confirm: (plan) =>
      Promise.resolve(answers.confirm ? { title: answers.title ?? plan.defaultTitle } : undefined),
    branchName: () => Promise.resolve(answers.branch),
  };
}

function newPagePrompts(answers: NewPageAnswers): NewPagePrompts {
  return {
    chooseFolder: () => Promise.resolve(undefined),
    askTitle: () => Promise.resolve(answers.title),
    askFileName: () => Promise.resolve(answers.fileName),
    chooseCollection: (candidates) =>
      Promise.resolve(candidates.find(({ id }) => id === answers.collection)),
  };
}

export function createTestApi(deps: TestApiDependencies): LorequillInternalApi {
  const { registry, commits, submissions, reviewStore, reviewStatus } = deps;
  return {
    pagesTree: () => snapshotOf(deps.pages, deps.pages.getChildren()),
    loadedFolderCount: () => registry.loadedFolderCount(),
    setPageFilter: deps.setPageFilter,
    languageServerRunning: deps.languageServerRunning,
    checkPages: deps.checkPages,
    editorSessions: () => deps.pageEditor.probes(),
    outlineTree: () => snapshotOf(deps.outline, deps.outline.getChildren()),
    properties: deps.properties,
    links: deps.links,
    git: deps.gitProbe,
    commit: (answers) => commits.commit(answers.folder, commitPrompts(answers)),
    verifyCommit: (folder) => commits.verify(folder),
    submit: (answers) => submissions.submit(answers.folder, submitPrompts(answers)),
    useMockHost: () => {
      const host = new MockReviewHost();
      submissions.setHostResolver(() => host);
      return host;
    },
    review: async (folder) => {
      const model = registry.models().find((candidate) => candidate.folder.name === folder);
      const binding = model && (await deps.git.bind(model));
      const root = binding && "repository" in binding ? binding.repository.rootUri : undefined;
      await reviewStatus.update();
      return {
        state: root && reviewStore.state(root)?.kind,
        blocksSubmit: root ? reviewStore.blocksSubmit(root) : false,
        status: reviewStatus.probe(),
      };
    },
    createPage: (directory, answers) => {
      const model = registry.models().find(({ status }) => status.kind === "ready");
      return createPage(
        registry,
        deps.translate,
        model && { kind: "directory", model, node: { path: directory } },
        newPagePrompts(answers),
      );
    },
  };
}
