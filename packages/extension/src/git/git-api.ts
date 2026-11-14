import type * as vscode from "vscode";

/*
 * The part of the built-in Git extension's API (`vscode.git`, API version 1) that Lorequill
 * uses, declared here instead of copying the full `git.d.ts`. Every member exists in the API
 * since VS Code 1.110, the minimum version in the manifest.
 */

export interface GitExtension {
  readonly enabled: boolean;
  readonly onDidChangeEnablement: vscode.Event<boolean>;
  getAPI(version: 1): GitApi;
}

export interface GitApi {
  readonly state: "uninitialized" | "initialized";
  readonly onDidChangeState: vscode.Event<"uninitialized" | "initialized">;
  readonly git: { readonly path: string };
  readonly repositories: readonly GitRepository[];
  readonly onDidOpenRepository: vscode.Event<GitRepository>;
  readonly onDidCloseRepository: vscode.Event<GitRepository>;
  getRepository(uri: vscode.Uri): GitRepository | null;
  openRepository(root: vscode.Uri): Promise<GitRepository | null>;
}

export interface GitRepository {
  readonly rootUri: vscode.Uri;
  readonly state: GitRepositoryState;
  /** Stages whole files (`git add`). */
  add(paths: readonly string[]): Promise<void>;
  /** Unstages whole files: resets their index entries to `HEAD` (or removes them if unborn). */
  revert(paths: readonly string[]): Promise<void>;
  /** Re-reads the repository status. */
  status(): Promise<void>;
  /** Fetches `ref` from `remote` with VS Code's credential handling. */
  fetch(remote?: string, ref?: string, depth?: number): Promise<void>;
  /** Creates a branch at `HEAD` (or `ref`) and checks it out when `checkout` is set. */
  createBranch(name: string, checkout: boolean, ref?: string): Promise<void>;
  /** Pushes a branch; Lorequill never passes the force argument. */
  push(remoteName?: string, branchName?: string, setUpstream?: boolean): Promise<void>;
}

export interface GitRepositoryState {
  readonly HEAD: GitBranch | undefined;
  readonly remotes: readonly GitRemote[];
  readonly mergeChanges: readonly GitChange[];
  readonly indexChanges: readonly GitChange[];
  readonly workingTreeChanges: readonly GitChange[];
  /** Separate untracked changes, only when `git.untrackedChanges` is `separate`. */
  readonly untrackedChanges?: readonly GitChange[];
  readonly onDidChange: vscode.Event<void>;
}

export interface GitBranch {
  /** 0: local head, 1: remote head, 2: tag. */
  readonly type: number;
  readonly name?: string;
  readonly commit?: string;
  readonly upstream?: { readonly remote: string; readonly name: string };
  readonly ahead?: number;
  readonly behind?: number;
}

export interface GitRemote {
  readonly name: string;
  readonly fetchUrl?: string;
  readonly pushUrl?: string;
}

export interface GitChange {
  readonly uri: vscode.Uri;
  readonly originalUri: vscode.Uri;
  readonly renameUri: vscode.Uri | undefined;
  readonly status: number;
}
