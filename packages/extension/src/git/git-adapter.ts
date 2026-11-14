import { realpath } from "node:fs/promises";
import { isAbsolute, relative, sep } from "node:path";
import * as vscode from "vscode";
import { GitBinary } from "../core/git/git-process";
import {
  contentPrefix,
  findRepositoryRoot,
  readHead,
  readIndex,
  type Head,
} from "../core/git/repository";
import { headChanged, repositoryProblems, type RepositoryProblem } from "../core/git/status";
import { createIndexSnapshot, type TreeSnapshot } from "../core/git/tree-snapshot";
import type { Logger } from "../core/logger";
import type { FolderModel, FolderRegistry } from "../folders/folder-registry";
import type { ChangedFile } from "../core/git/commit-plan";
import type { GitApi, GitBranch, GitChange, GitExtension, GitRepository } from "./git-api";

/** `Status.UNTRACKED` and `Status.IGNORED` of the Git extension API. */
const STATUS_UNTRACKED = 7;
const STATUS_IGNORED = 8;

/** Why a folder has no usable repository. */
export type GitUnavailable =
  /** The workspace is untrusted or the folder has no ready profile and content root. */
  | { readonly kind: "not-ready" }
  /** The built-in Git extension is missing, disabled, or has no Git binary. */
  | { readonly kind: "git-unavailable" }
  /** The content root is not inside a Git work tree. */
  | { readonly kind: "no-repository" }
  /** Git found a repository that the Git extension has not opened and cannot open. */
  | { readonly kind: "repository-not-open" };

/** The repository of one folder's content root. */
export interface RepositoryBinding {
  readonly folder: vscode.WorkspaceFolder;
  readonly repository: GitRepository;
  /** Real path of the repository root; Git commands run here. */
  readonly root: string;
  /** The content root relative to the repository root, POSIX, empty for the root itself. */
  readonly prefix: string;
  /**
   * The workspace folder relative to the repository root, or `undefined` when the folder is not
   * inside the repository (only its content root lies in a nested repository).
   */
  readonly folderPrefix: string | undefined;
  readonly git: GitBinary;
}

export interface RepositoryStatus {
  readonly kind: "status";
  readonly root: vscode.Uri;
  readonly head: Head;
  readonly upstream?: { readonly remote: string; readonly name: string };
  readonly ahead?: number;
  readonly behind?: number;
  readonly remotes: readonly string[];
  /** Files with staged changes (anywhere in the repository, not only the content root). */
  readonly staged: readonly vscode.Uri[];
  /** Tracked files with unstaged changes. */
  readonly unstaged: readonly vscode.Uri[];
  /** Files with merge conflicts. */
  readonly conflicted: readonly vscode.Uri[];
  readonly problems: readonly RepositoryProblem[];
}

/** The staged tree of a folder's repository below its content root. */
export type StagedSnapshot =
  | {
      readonly kind: "snapshot";
      /** `HEAD` when the index was read; Commit verifies it is unchanged. */
      readonly head: Head;
      readonly snapshot: TreeSnapshot;
    }
  | { readonly kind: "conflicted"; readonly paths: readonly string[] };

export interface HeadChange {
  readonly root: vscode.Uri;
  readonly previous: Head;
  readonly current: Head;
}

/** `HEAD` as the Git extension last reported it, or `undefined` if unknown. */
function headOf(branch: GitBranch | undefined): Head | undefined {
  if (!branch) {
    return undefined;
  }
  if (branch.name === undefined) {
    return branch.commit === undefined ? undefined : { kind: "detached", commit: branch.commit };
  }
  return branch.commit === undefined
    ? { kind: "unborn", branch: branch.name }
    : { kind: "branch", branch: branch.name, commit: branch.commit };
}

/**
 * The Git adapter (specification §5, decision D4). The VS Code Git extension discovers
 * repositories, reports status, stages, unstages, and refreshes, so the Source Control view stays
 * current. The Git binary it reports runs read-only plumbing with argument arrays in the verified
 * repository root: `HEAD`, the index as a tree, and blob reads. Each folder's content root is
 * bound to the innermost repository that contains it, and nothing outside that repository is
 * staged, unstaged, or read; snapshots never reach outside the content root.
 */
export class GitAdapter implements vscode.Disposable {
  private api: GitApi | undefined;
  private readonly heads = new Map<
    string,
    { head: Head | undefined; listener: vscode.Disposable }
  >();
  private readonly subscriptions: vscode.Disposable[] = [];
  private readonly headEmitter = new vscode.EventEmitter<HeadChange>();
  private readonly changeEmitter = new vscode.EventEmitter<vscode.Uri>();

  /** `HEAD` moved: a checkout, commit, reset, or another branch, inside or outside VS Code. */
  readonly onDidChangeHead = this.headEmitter.event;
  /** The Git extension reported a new state of a watched repository (by root). */
  readonly onDidChangeRepository = this.changeEmitter.event;

  constructor(
    private readonly registry: FolderRegistry,
    private readonly logger: Logger,
  ) {
    this.subscriptions.push(
      registry.onDidChange(() => {
        void this.watchRepositories();
      }),
    );
  }

  /** Starts watching the repositories of ready folders. Safe to call more than once. */
  start(): void {
    void this.watchRepositories();
  }

  /** The repository of `model`'s content root. */
  async bind(model: FolderModel): Promise<RepositoryBinding | GitUnavailable> {
    const contentRoot = model.contentRoot;
    if (!this.registry.trusted || model.status.kind !== "ready" || contentRoot?.scheme !== "file") {
      return { kind: "not-ready" };
    }
    const api = await this.gitApi();
    if (!api) {
      return { kind: "git-unavailable" };
    }
    let root: string | undefined;
    try {
      root = await findRepositoryRoot(api.git.path, contentRoot.fsPath);
    } catch {
      return { kind: "git-unavailable" };
    }
    const prefix = root === undefined ? undefined : await contentPrefix(root, contentRoot.fsPath);
    if (root === undefined || prefix === undefined) {
      return { kind: "no-repository" };
    }
    const repository = await this.repositoryAt(api, root);
    if (!repository) {
      return { kind: "repository-not-open" };
    }
    return {
      folder: model.folder,
      repository,
      root,
      prefix,
      folderPrefix: await contentPrefix(root, model.folder.uri.fsPath).catch(() => undefined),
      git: new GitBinary(api.git.path, root),
    };
  }

  /**
   * The changed files of a repository as the Git extension reports them: staged, unstaged, and
   * untracked, merged per file, with paths relative to the repository root. Ignored files and
   * files outside the repository root are left out.
   */
  changedFiles(binding: RepositoryBinding): ChangedFile[] {
    const files = new Map<string, { staged: boolean; unstaged: boolean; untracked: boolean }>();
    const state = binding.repository.state;
    const root = binding.repository.rootUri.fsPath;
    const add = (change: GitChange, staged: boolean): void => {
      if (change.status === STATUS_IGNORED) {
        return;
      }
      const path = relative(root, change.uri.fsPath);
      if (path === "" || path === ".." || path.startsWith(`..${sep}`) || isAbsolute(path)) {
        return;
      }
      const key = path.split(sep).join("/");
      const entry = files.get(key) ?? { staged: false, unstaged: false, untracked: false };
      if (staged) {
        entry.staged = true;
      } else {
        entry.unstaged = true;
        entry.untracked ||= change.status === STATUS_UNTRACKED;
      }
      files.set(key, entry);
    };
    for (const change of state.indexChanges) {
      add(change, true);
    }
    for (const change of [...state.workingTreeChanges, ...(state.untrackedChanges ?? [])]) {
      add(change, false);
    }
    return [...files].map(([path, entry]) => ({ path, ...entry }));
  }

  /** Branch, `HEAD`, remotes, index, and working tree of `model`'s repository. */
  async status(model: FolderModel): Promise<RepositoryStatus | GitUnavailable> {
    const binding = await this.bind(model);
    if (!("repository" in binding)) {
      return binding;
    }
    const head = await readHead(binding.git);
    const state = binding.repository.state;
    const remotes = state.remotes.map(({ name }) => name);
    const conflicted = state.mergeChanges.map(({ uri }) => uri);
    const baseBranch =
      model.status.kind === "ready" ? model.status.profile.review?.base_branch : undefined;
    const branch = state.HEAD;
    return {
      kind: "status",
      root: binding.repository.rootUri,
      head,
      ...(branch?.upstream ? { upstream: branch.upstream } : {}),
      ...(branch?.ahead === undefined ? {} : { ahead: branch.ahead }),
      ...(branch?.behind === undefined ? {} : { behind: branch.behind }),
      remotes,
      staged: state.indexChanges.map(({ uri }) => uri),
      unstaged: state.workingTreeChanges.map(({ uri }) => uri),
      conflicted,
      problems: repositoryProblems({
        head,
        remotes,
        conflicted: conflicted.length,
        baseBranch,
      }),
    };
  }

  /**
   * A read-only snapshot of the staged tree below `model`'s content root (specification §12),
   * for the commit check. The caller disposes the snapshot.
   */
  async stagedSnapshot(
    model: FolderModel,
    signal?: AbortSignal,
  ): Promise<StagedSnapshot | GitUnavailable> {
    const binding = await this.bind(model);
    if (!("repository" in binding)) {
      return binding;
    }
    const head = await readHead(binding.git, signal);
    const index = await readIndex(binding.git, signal);
    if (index.kind === "conflicted") {
      return index;
    }
    return {
      kind: "snapshot",
      head,
      snapshot: createIndexSnapshot(binding.git, index, binding.prefix),
    };
  }

  /** Stages whole files of `model`'s repository through the Git extension. */
  async stage(model: FolderModel, files: readonly vscode.Uri[]): Promise<boolean> {
    return this.withFiles(model, files, (repository, paths) => repository.add(paths));
  }

  /** Unstages whole files of `model`'s repository through the Git extension. */
  async unstage(model: FolderModel, files: readonly vscode.Uri[]): Promise<boolean> {
    return this.withFiles(model, files, (repository, paths) => repository.revert(paths));
  }

  /** Asks the Git extension to re-read `model`'s repository, after any Git change. */
  async refresh(model: FolderModel): Promise<void> {
    const binding = await this.bind(model);
    if ("repository" in binding) {
      await binding.repository.status();
    }
  }

  dispose(): void {
    for (const { listener } of this.heads.values()) {
      listener.dispose();
    }
    this.heads.clear();
    for (const subscription of this.subscriptions.splice(0)) {
      subscription.dispose();
    }
    this.headEmitter.dispose();
    this.changeEmitter.dispose();
  }

  /**
   * Runs `action` with the real paths of `files` after checking that each one lies inside the
   * repository root. Returns `false`, without running anything, if one does not.
   */
  private async withFiles(
    model: FolderModel,
    files: readonly vscode.Uri[],
    action: (repository: GitRepository, paths: string[]) => Promise<void>,
  ): Promise<boolean> {
    const binding = await this.bind(model);
    if (!("repository" in binding) || files.length === 0) {
      return false;
    }
    const paths: string[] = [];
    for (const file of files) {
      if (file.scheme !== "file" || !(await isInside(binding.root, file.fsPath))) {
        return false;
      }
      paths.push(file.fsPath);
    }
    await action(binding.repository, paths);
    await binding.repository.status();
    return true;
  }

  private async gitApi(): Promise<GitApi | undefined> {
    if (this.api) {
      return this.api;
    }
    const extension = vscode.extensions.getExtension<GitExtension>("vscode.git");
    if (!extension) {
      return undefined;
    }
    try {
      const exports = extension.isActive ? extension.exports : await extension.activate();
      if (!exports.enabled) {
        return undefined;
      }
      const api = exports.getAPI(1);
      if (api.state !== "initialized") {
        await new Promise<void>((resolve) => {
          const listener = api.onDidChangeState((state) => {
            if (state === "initialized") {
              listener.dispose();
              resolve();
            }
          });
        });
      }
      this.api = api;
      this.subscriptions.push(
        api.onDidOpenRepository(() => void this.watchRepositories()),
        api.onDidCloseRepository(() => void this.watchRepositories()),
      );
      return api;
    } catch {
      return undefined;
    }
  }

  /** The Git extension's repository whose root is `root`, opening it if Git found it first. */
  private async repositoryAt(api: GitApi, root: string): Promise<GitRepository | undefined> {
    const known = api.getRepository(vscode.Uri.file(root));
    if (known && (await samePath(known.rootUri.fsPath, root))) {
      return known;
    }
    // The innermost repository, for example a nested one the Git extension did not scan.
    const opened = await api.openRepository(vscode.Uri.file(root));
    return opened && (await samePath(opened.rootUri.fsPath, root)) ? opened : undefined;
  }

  /** Follows `HEAD` of every repository bound to a ready folder. */
  private async watchRepositories(): Promise<void> {
    const watched = new Map<string, GitRepository>();
    for (const model of this.registry.models()) {
      const binding = await this.bind(model);
      if ("repository" in binding) {
        watched.set(binding.repository.rootUri.toString(), binding.repository);
      }
    }
    let changed = false;
    for (const [key, entry] of this.heads) {
      if (!watched.has(key)) {
        entry.listener.dispose();
        this.heads.delete(key);
        changed = true;
      }
    }
    for (const [key, repository] of watched) {
      if (this.heads.has(key)) {
        continue;
      }
      const head = headOf(repository.state.HEAD);
      const listener = repository.state.onDidChange(() => {
        this.onRepositoryChange(key, repository);
      });
      this.heads.set(key, { head, listener });
      changed = true;
    }
    if (changed) {
      this.logger.info("git", { repositories: watched.size });
    }
  }

  private onRepositoryChange(key: string, repository: GitRepository): void {
    const entry = this.heads.get(key);
    const current = headOf(repository.state.HEAD);
    if (entry && current) {
      const previous = entry.head;
      entry.head = current;
      if (previous && headChanged(previous, current)) {
        this.headEmitter.fire({ root: repository.rootUri, previous, current });
      }
    }
    this.changeEmitter.fire(repository.rootUri);
  }
}

async function samePath(a: string, b: string): Promise<boolean> {
  try {
    const [left, right] = await Promise.all([realpath(a), realpath(b)]);
    return relative(left, right) === "";
  } catch {
    return false;
  }
}

/**
 * Whether `path` lies inside `root` (a real path). The real path of the nearest existing
 * ancestor is used, so a deleted file can still be unstaged, but a symbolic link cannot point a
 * path outside the repository.
 */
async function isInside(root: string, path: string): Promise<boolean> {
  let existing = path;
  let rest = "";
  for (;;) {
    try {
      const real = await realpath(existing);
      const inside = relative(root, rest === "" ? real : `${real}${rest}`);
      return (
        inside !== "" && inside !== ".." && !inside.startsWith(`..${sep}`) && !isAbsolute(inside)
      );
    } catch {
      const parent = existing.replace(/[\\/][^\\/]*$/, "");
      if (parent === existing || parent === "") {
        return false;
      }
      rest = existing.slice(parent.length) + rest;
      existing = parent;
    }
  }
}

/** The Git adapter by workspace folder name, with plain values, for integration tests. */
export interface GitProbe {
  binding(folder: string): Promise<{ readonly root: string; readonly prefix: string } | string>;
  status(folder: string): Promise<
    | {
        readonly head: Head;
        readonly remotes: readonly string[];
        readonly staged: readonly string[];
        readonly unstaged: readonly string[];
        readonly problems: readonly RepositoryProblem[];
      }
    | string
  >;
  /** The staged snapshot's tree, `HEAD`, and the texts of all listed files. */
  staged(folder: string): Promise<
    | {
        readonly tree: string;
        readonly head: Head;
        readonly texts: Readonly<Record<string, string | undefined>>;
      }
    | string
  >;
  stage(folder: string, paths: readonly string[]): Promise<boolean>;
  unstage(folder: string, paths: readonly string[]): Promise<boolean>;
  /** `HEAD` changes reported since activation, oldest first. */
  readonly headChanges: readonly HeadChange[];
}

export function createGitProbe(adapter: GitAdapter, registry: FolderRegistry): GitProbe {
  const headChanges: HeadChange[] = [];
  adapter.onDidChangeHead((change) => headChanges.push(change));
  const modelOf = (name: string): FolderModel => {
    const model = registry.models().find(({ folder }) => folder.name === name);
    if (!model) {
      throw new Error(`No folder model for ${name}.`);
    }
    return model;
  };
  const uris = (paths: readonly string[]): vscode.Uri[] =>
    paths.map((path) => vscode.Uri.file(path));
  return {
    headChanges,
    async binding(folder) {
      const binding = await adapter.bind(modelOf(folder));
      return "repository" in binding
        ? { root: binding.root, prefix: binding.prefix }
        : binding.kind;
    },
    async status(folder) {
      const status = await adapter.status(modelOf(folder));
      if (status.kind !== "status") {
        return status.kind;
      }
      return {
        head: status.head,
        remotes: status.remotes,
        staged: status.staged.map(({ fsPath }) => fsPath),
        unstaged: status.unstaged.map(({ fsPath }) => fsPath),
        problems: status.problems,
      };
    },
    async staged(folder) {
      const result = await adapter.stagedSnapshot(modelOf(folder));
      if (result.kind !== "snapshot") {
        return result.kind;
      }
      const { snapshot, head } = result;
      try {
        const texts: Record<string, string | undefined> = {};
        for (const path of (await snapshot.listFiles()).files) {
          texts[path] = await snapshot.readText(path);
        }
        return { tree: snapshot.tree, head, texts };
      } finally {
        snapshot.dispose();
      }
    },
    stage: (folder, paths) => adapter.stage(modelOf(folder), uris(paths)),
    unstage: (folder, paths) => adapter.unstage(modelOf(folder), uris(paths)),
  };
}
