import * as assert from "node:assert/strict";
import * as path from "node:path";
import { inspect } from "node:util";
import * as vscode from "vscode";

/** Mirrors `TreeSnapshot` of src/extension.ts (test code cannot import the extension sources). */
export interface TreeSnapshot {
  readonly label: string;
  readonly description?: string;
  readonly resource?: string;
  readonly command?: string;
  readonly children: readonly TreeSnapshot[];
}

/** Mirrors `EditorSessionProbe` of src/editor/page-editor.ts. */
export interface EditorSessionProbe {
  readonly uri: vscode.Uri;
  readonly sent: readonly { readonly type: string; readonly [key: string]: unknown }[];
  receive(message: unknown): Promise<void>;
}

/** The Properties view, as far as the tests use it. */
export interface PropertiesProbe {
  readonly lastModel:
    | { readonly status: string; readonly page?: string; readonly [key: string]: unknown }
    | undefined;
  applyRequest(
    request:
      | { readonly type: "set"; readonly key: string; readonly value: string | boolean | string[] }
      | { readonly type: "insertDefault"; readonly key: string },
  ): Promise<boolean>;
  refresh(): void;
  idle(): Promise<void>;
}

/** `HEAD` as the Git adapter reports it. */
export type GitHead =
  | { readonly kind: "branch"; readonly branch: string; readonly commit: string }
  | { readonly kind: "unborn"; readonly branch: string }
  | { readonly kind: "detached"; readonly commit: string };

/** Mirrors `GitProbe` of src/git/git-adapter.ts. */
export interface GitProbe {
  binding(folder: string): Promise<{ readonly root: string; readonly prefix: string } | string>;
  status(folder: string): Promise<
    | {
        readonly head: GitHead;
        readonly remotes: readonly string[];
        readonly staged: readonly string[];
        readonly unstaged: readonly string[];
        readonly problems: readonly string[];
      }
    | string
  >;
  staged(folder: string): Promise<
    | {
        readonly tree: string;
        readonly head: GitHead;
        readonly texts: Readonly<Record<string, string | undefined>>;
      }
    | string
  >;
  stage(folder: string, paths: readonly string[]): Promise<boolean>;
  unstage(folder: string, paths: readonly string[]): Promise<boolean>;
  readonly headChanges: readonly { readonly previous: GitHead; readonly current: GitHead }[];
}

/** The mock review host of src/core/host/mock-host.ts, as far as the tests use it. */
export interface MockHost {
  readonly reviews: readonly {
    readonly number: number;
    readonly state: string;
    readonly title: string;
    readonly branch: string;
    readonly base: string;
  }[];
  readonly calls: readonly string[];
  add(branch: string, base: string, state: "open" | "closed" | "merged", title?: string): unknown;
  failNextCreate(): void;
}

/** Mirrors `LorequillInternalApi` of src/extension.ts. */
export interface InternalApi {
  readonly pagesTree: () => readonly TreeSnapshot[];
  readonly setPageFilter: (text: string) => void;
  readonly loadedFolderCount: () => number;
  readonly languageServerRunning: () => boolean;
  readonly editorSessions: () => readonly EditorSessionProbe[];
  readonly outlineTree: () => readonly TreeSnapshot[];
  readonly properties: PropertiesProbe;
  readonly git: GitProbe;
  readonly commit: (answers: {
    folder?: string;
    select?: readonly string[];
    confirm?: boolean;
    message?: string;
  }) => Promise<string>;
  readonly verifyCommit: (folder: string) => Promise<string>;
  readonly submit: (answers: {
    folder?: string;
    remote?: string;
    confirm?: boolean;
    title?: string;
    branch?: string;
  }) => Promise<
    | {
        readonly kind: string;
        readonly reason?: string;
        readonly base?: string;
        readonly created?: boolean;
        readonly failure?: string;
      }
    | undefined
  >;
  readonly useMockHost: () => MockHost;
  readonly review: (folder: string) => Promise<{
    readonly state: string | undefined;
    readonly blocksSubmit: boolean;
    readonly status: {
      readonly visible: boolean;
      readonly text: string;
      readonly command?: string;
    };
  }>;
  readonly createPage: (
    directory: string,
    answers: { title?: string; fileName?: string; collection?: string },
  ) => Promise<vscode.Uri | undefined>;
  readonly checkPages: () => Promise<
    | {
        readonly folders: readonly {
          readonly folderUri: string;
          readonly status: string;
          readonly findings: number;
          readonly pagesChecked: number;
        }[];
      }
    | undefined
  >;
}

// Compiled location: out/test/integration/suite/support.js
const EXTENSION_PATH = path.resolve(__dirname, "../../../..");

/** The extension is located by its path, because the publisher is not chosen yet. */
export function findExtension(): vscode.Extension<unknown> {
  // `path.relative` compares case-insensitively on Windows, where VS Code may report the drive
  // letter in lower case ("c:\\...") and Node in upper case ("C:\\...").
  const extension = vscode.extensions.all.find(
    (candidate) => path.relative(candidate.extensionPath, EXTENSION_PATH) === "",
  );
  assert.ok(extension, `Lorequill extension not found at ${EXTENSION_PATH}`);
  return extension;
}

export async function activateExtension(): Promise<InternalApi> {
  const extension = findExtension();
  return (await extension.activate()) as InternalApi;
}

/** Polls until `read` returns a value that satisfies `accept`, then returns it. */
/** A value for a failure message; objects such as editor sessions can be circular. */
function describeValue(value: unknown): string {
  try {
    return value === undefined ? "undefined" : JSON.stringify(value);
  } catch {
    return inspect(value, { depth: 1 });
  }
}

/** A webview starts a browser context; slow CI machines can take longer than for other waits. */
export const WEBVIEW_TIMEOUT_MS = 45_000;

export async function waitFor<T>(
  description: string,
  read: () => T,
  accept: (value: T) => boolean,
  timeoutMs = 15_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let last = read();
  while (!accept(last)) {
    if (Date.now() > deadline) {
      assert.fail(`Timed out waiting for ${description}. Last value: ${describeValue(last)}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
    last = read();
  }
  return last;
}

/**
 * Makes a file change, then waits like {@link waitFor}. While waiting, the change is repeated every
 * few seconds: VS Code's file watcher starts asynchronously and can miss an event while it is still
 * starting on a busy CI machine. A refresh is still required for the test to pass.
 */
export async function waitForChange<T>(
  change: () => Promise<unknown>,
  description: string,
  read: () => T,
  accept: (value: T) => boolean,
  timeoutMs = 30_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  await change();
  let repeatAt = Date.now() + 3_000;
  let last = read();
  while (!accept(last)) {
    if (Date.now() > deadline) {
      assert.fail(`Timed out waiting for ${description}. Last value: ${describeValue(last)}`);
    }
    if (Date.now() > repeatAt) {
      await change();
      repeatAt = Date.now() + 3_000;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
    last = read();
  }
  return last;
}

/** Like {@link waitFor}, for a value that is read asynchronously. */
export async function waitForAsync<T>(
  description: string,
  read: () => Promise<T>,
  accept: (value: T) => boolean,
  timeoutMs = 15_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let last = await read();
  while (!accept(last)) {
    if (Date.now() > deadline) {
      assert.fail(`Timed out waiting for ${description}. Last value: ${describeValue(last)}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
    last = await read();
  }
  return last;
}

/** Labels of a tree, depth first, indented by depth; easier to compare than nested objects. */
export function outline(nodes: readonly TreeSnapshot[], depth = 0): string[] {
  return nodes.flatMap((node) => [
    `${"  ".repeat(depth)}${node.label}${node.description === undefined ? "" : ` [${node.description}]`}`,
    ...outline(node.children, depth + 1),
  ]);
}

export function findNode(nodes: readonly TreeSnapshot[], label: string): TreeSnapshot | undefined {
  for (const node of nodes) {
    if (node.label === label) {
      return node;
    }
    const inner = findNode(node.children, label);
    if (inner) {
      return inner;
    }
  }
  return undefined;
}
