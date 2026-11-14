import { realpath } from "node:fs/promises";
import { isAbsolute, relative, sep } from "node:path";
import { GitBinary, GitError } from "./git-process";
import { computeTreeId, type ObjectFormat, type TreeFile } from "./tree-id";

/** The state of `HEAD`, read from Git itself rather than from cached status. */
export type Head =
  /** On a branch with at least one commit. */
  | { readonly kind: "branch"; readonly branch: string; readonly commit: string }
  /** On a branch without commits, as in a fresh repository. */
  | { readonly kind: "unborn"; readonly branch: string }
  /** Not on a branch. */
  | { readonly kind: "detached"; readonly commit: string };

/** The index as the tree the next commit would contain, or why it has none. */
export type IndexTree =
  | {
      readonly kind: "tree";
      /** The tree ID, as `git write-tree` would print it. */
      readonly tree: string;
      /** The files of the tree, in index order. */
      readonly files: readonly TreeFile[];
    }
  /** The index has unmerged entries, as during a merge conflict. */
  | { readonly kind: "conflicted"; readonly paths: readonly string[] };

const BRANCH_REF = "refs/heads/";

/** Reads `HEAD`: the branch it points to, if any, and the commit, if one exists. */
export async function readHead(git: GitBinary, signal?: AbortSignal): Promise<Head> {
  const symbolic = await git.run(["symbolic-ref", "-q", "HEAD"], { signal });
  const commit = await git.run(["rev-parse", "-q", "--verify", "HEAD^{commit}"], { signal });
  const id = commit.exitCode === 0 ? commit.stdout.toString("utf8").trim() : undefined;
  if (symbolic.exitCode === 0) {
    const ref = symbolic.stdout.toString("utf8").trim();
    const branch = ref.startsWith(BRANCH_REF) ? ref.slice(BRANCH_REF.length) : ref;
    return id === undefined ? { kind: "unborn", branch } : { kind: "branch", branch, commit: id };
  }
  if (id === undefined) {
    throw new GitError("HEAD is neither a branch nor a commit.", ["rev-parse"], commit.exitCode);
  }
  return { kind: "detached", commit: id };
}

/** Index entry flag of `git add --intent-to-add`; such entries are not part of the tree. */
const INTENT_TO_ADD = 0x2000_0000;

/**
 * Reads the index as a tree (specification §12) without changing anything: `git ls-files`
 * reads the index file and nothing else, while `git write-tree` would rewrite the index and can
 * run hooks and content filters for racily clean entries. The tree ID is computed from the
 * entries with Git's tree format. The index already combines unchanged `HEAD` content with
 * staged additions, modifications, and deletions, so this is exactly what the next commit would
 * contain. `--debug` adds each entry's flags, which identify intent-to-add entries.
 */
export async function readIndex(git: GitBinary, signal?: AbortSignal): Promise<IndexTree> {
  const output = await git.run(["ls-files", "--stage", "-z", "--debug"], { signal });
  if (output.exitCode !== 0) {
    throw new GitError("git ls-files failed.", ["ls-files"], output.exitCode, output.stderr);
  }
  const files: TreeFile[] = [];
  const unmerged = new Set<string>();
  const data = output.stdout;
  let position = 0;
  while (position < data.length) {
    // <mode> SP <object> SP <stage> TAB <path> NUL, then indented debug lines up to `flags: <hex>`.
    const tab = data.indexOf(0x09, position);
    const nul = data.indexOf(0x00, tab + 1);
    const flagsAt = data.indexOf("flags: ", nul + 1);
    const lineEnd = data.indexOf(0x0a, flagsAt);
    if (tab === -1 || nul === -1 || flagsAt === -1 || lineEnd === -1) {
      throw new GitError("Unexpected git ls-files output.", ["ls-files"]);
    }
    const [mode = "", object = "", stage = ""] = data
      .subarray(position, tab)
      .toString("latin1")
      .split(" ");
    const path = Buffer.from(data.subarray(tab + 1, nul));
    const flags = Number.parseInt(data.subarray(flagsAt + 7, lineEnd).toString("latin1"), 16);
    position = lineEnd + 1;
    if (!/^[0-7]{6}$/.test(mode) || !/^[0-9a-f]{40}(?:[0-9a-f]{24})?$/.test(object)) {
      throw new GitError("Unexpected git ls-files output.", ["ls-files"]);
    }
    if (stage !== "0") {
      unmerged.add(path.toString("utf8"));
    } else if ((flags & INTENT_TO_ADD) === 0) {
      files.push({ mode, object, path });
    }
  }
  if (unmerged.size > 0) {
    return { kind: "conflicted", paths: [...unmerged].sort() };
  }
  return { kind: "tree", tree: computeTreeId(files, await readObjectFormat(git, signal)), files };
}

/** The repository's object hash algorithm. */
export async function readObjectFormat(
  git: GitBinary,
  signal?: AbortSignal,
): Promise<ObjectFormat> {
  const output = await git.run(["rev-parse", "--show-object-format"], { signal });
  return output.stdout.toString("utf8").trim() === "sha256" ? "sha256" : "sha1";
}

/** The tree of a commit, for verifying what a commit contains. */
export function readCommitTree(
  git: GitBinary,
  commit: string,
  signal?: AbortSignal,
): Promise<string> {
  return git.text(["rev-parse", "--verify", "--end-of-options", `${commit}^{tree}`], { signal });
}

/**
 * The root of the repository that contains `directory`, as Git resolves it: the innermost
 * repository, so a content root inside a nested repository belongs to that repository. Returns
 * `undefined` when `directory` is not inside a work tree.
 */
export async function findRepositoryRoot(
  gitPath: string,
  directory: string,
  signal?: AbortSignal,
): Promise<string | undefined> {
  const output = await new GitBinary(gitPath, directory).run(["rev-parse", "--show-toplevel"], {
    signal,
  });
  const root = output.stdout.toString("utf8").trim();
  return output.exitCode === 0 && root !== "" ? realpath(root) : undefined;
}

/**
 * The POSIX path of `contentRoot` relative to `repositoryRoot`, both resolved to real paths;
 * empty when they are the same directory. `undefined` when the content root is not inside the
 * repository, so no snapshot or Git operation of this repository can reach it.
 */
export async function contentPrefix(
  repositoryRoot: string,
  contentRoot: string,
): Promise<string | undefined> {
  const [root, content] = await Promise.all([realpath(repositoryRoot), realpath(contentRoot)]);
  const path = relative(root, content);
  if (path === "") {
    return "";
  }
  if (isAbsolute(path) || path === ".." || path.startsWith(`..${sep}`)) {
    return undefined;
  }
  return path.split(sep).join("/");
}

/**
 * Whether the index differs from `HEAD`, so a commit would record something. Compares tree IDs
 * only, without Git's diff machinery, so no external diff or text conversion can run.
 */
export async function hasStagedChanges(git: GitBinary, signal?: AbortSignal): Promise<boolean> {
  const index = await readIndex(git, signal);
  if (index.kind === "conflicted") {
    return true;
  }
  const head = await readHead(git, signal);
  if (head.kind === "unborn") {
    return index.files.length > 0;
  }
  return index.tree !== (await readCommitTree(git, head.commit, signal));
}

/** Commits listed before submission; the rest are counted as "more". */
export const MAX_LISTED_COMMITS = 200;

// Control characters are rejected on purpose, like Git does for ref names.
// eslint-disable-next-line no-control-regex
const REF_PART = /^(?!.*\.\.)(?!-)[^\s~^:?*[\\\x00-\x1f\x7f]+$/;

/**
 * The commits on `HEAD` that are not on the remote-tracking branch `remote/base`, newest first,
 * as `git log` lists them (specification §12: everything a review will contain). `undefined` if
 * the remote-tracking branch does not exist. Signatures are not verified, so no GPG runs.
 */
export async function commitsSince(
  git: GitBinary,
  remote: string,
  base: string,
  signal?: AbortSignal,
): Promise<{ commits: { id: string; subject: string }[]; truncated: boolean } | undefined> {
  if (!REF_PART.test(remote) || remote.includes("/") || !REF_PART.test(base)) {
    return undefined;
  }
  const ref = `refs/remotes/${remote}/${base}`;
  const exists = await git.run(
    ["rev-parse", "-q", "--verify", "--end-of-options", `${ref}^{commit}`],
    {
      signal,
    },
  );
  if (exists.exitCode !== 0) {
    return undefined;
  }
  const output = await git.text(
    [
      "log",
      "--no-show-signature",
      "--no-color",
      `--max-count=${String(MAX_LISTED_COMMITS + 1)}`,
      "--format=%H%x1f%s%x1e",
      "--end-of-options",
      `${ref}..HEAD`,
    ],
    { signal },
  );
  const commits = output
    .split("\x1e")
    .map((record) => record.trim())
    .filter((record) => record !== "")
    .map((record) => {
      const [id = "", subject = ""] = record.split("\x1f");
      return { id, subject };
    });
  return {
    commits: commits.slice(0, MAX_LISTED_COMMITS),
    truncated: commits.length > MAX_LISTED_COMMITS,
  };
}

/**
 * Moves the local branch `base` to `remote/base` after its commits were carried to `carrier`: only
 * if `base` and `carrier` still point at `tip`, so no commit is left without a branch, and
 * atomically against `tip`, so a concurrent change of `base` wins. The reflog keeps the old
 * position. Returns whether the branch was moved.
 */
export async function resetBranchToRemote(
  git: GitBinary,
  base: string,
  remote: string,
  carrier: string,
  tip: string,
  signal?: AbortSignal,
): Promise<boolean> {
  if (!REF_PART.test(remote) || remote.includes("/") || !REF_PART.test(base)) {
    return false;
  }
  const resolve = async (ref: string): Promise<string | undefined> => {
    const result = await git.run(
      ["rev-parse", "-q", "--verify", "--end-of-options", `${ref}^{commit}`],
      { signal },
    );
    return result.exitCode === 0 ? result.stdout.toString("utf8").trim() : undefined;
  };
  const target = await resolve(`refs/remotes/${remote}/${base}`);
  if (
    target === undefined ||
    (await resolve(`refs/heads/${base}`)) !== tip ||
    (await resolve(`refs/heads/${carrier}`)) !== tip
  ) {
    return false;
  }
  const result = await git.run(
    [
      "update-ref",
      "-m",
      `lorequill: commits moved to ${carrier}`,
      `refs/heads/${base}`,
      target,
      tip,
    ],
    { signal },
  );
  return result.exitCode === 0;
}
