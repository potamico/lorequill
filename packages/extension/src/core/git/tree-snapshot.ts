import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { MAX_LISTED_ENTRIES, type ContentSnapshot, type FileListing } from "@lorequill/checks";
import type { TargetKind } from "@lorequill/markdown";
import type { GitBinary } from "./git-process";
import type { IndexTree } from "./repository";
import type { TreeFile } from "./tree-id";

/** A read-only snapshot of one Git tree below a content root. */
export interface TreeSnapshot extends ContentSnapshot {
  /** The ID of the tree the snapshot reads; it never changes. */
  readonly tree: string;
  /** Ends the blob reader process. Reads after this start a new one. */
  dispose(): void;
}

export interface TreeSnapshotOptions {
  /** Listing stops after this many entries below the content root and is then incomplete. */
  readonly maxEntries?: number;
  /** Blobs larger than this are not read; `readText` returns `undefined` for them. */
  readonly maxBlobBytes?: number;
}

interface TreeEntry {
  readonly kind: TargetKind;
  readonly object: string;
}

interface Listing {
  readonly entries: ReadonlyMap<string, TreeEntry>;
  readonly files: readonly string[];
  readonly truncated: boolean;
  readonly rootExists: boolean;
}

const DEFAULT_MAX_BLOB_BYTES = 16 * 1024 * 1024;
const OBJECT_ID = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/;

/**
 * Kind of a tree entry by its Git mode. Symbolic links and submodules are not followed, because
 * their targets are not part of the tree; they count as unsupported special files (§15).
 */
function kindOf(mode: string): TargetKind {
  if (mode === "100644" || mode === "100755") {
    return "file";
  }
  return mode === "040000" ? "directory" : "unsupported";
}

/**
 * A snapshot of the Git tree `tree` restricted to `prefix`, the content root relative to the
 * repository root (specification §11, §12), for checking a commit. Tree entries come from
 * `git ls-tree`. Paths outside the prefix are not listed and cannot be described or read.
 */
export function createTreeSnapshot(
  git: GitBinary,
  tree: string,
  prefix: string,
  options: TreeSnapshotOptions = {},
): TreeSnapshot {
  if (!OBJECT_ID.test(tree)) {
    throw new Error("Not a Git object ID.");
  }
  const maxEntries = options.maxEntries ?? MAX_LISTED_ENTRIES;
  return snapshotOf(
    git,
    tree,
    (signal) => listTree(git, tree, prefix, maxEntries, signal),
    options,
  );
}

/**
 * The staged snapshot: the files of the index below `prefix` (specification §12). It reads the
 * entries captured by {@link readIndex}, so the content and the tree ID belong to the same
 * index state, even if the index changes while a check runs.
 */
export function createIndexSnapshot(
  git: GitBinary,
  index: IndexTree & { readonly kind: "tree" },
  prefix: string,
  options: TreeSnapshotOptions = {},
): TreeSnapshot {
  const maxEntries = options.maxEntries ?? MAX_LISTED_ENTRIES;
  const listing = listIndex(index.files, prefix, maxEntries);
  return snapshotOf(git, index.tree, () => Promise.resolve(listing), options);
}

/**
 * The snapshot over a listing of tree entries. It reads only Git objects: blob contents come
 * from `git cat-file --batch`, which applies no filters and runs no repository code. Git objects
 * are immutable, so the snapshot cannot change while a check runs, whatever happens to the
 * index or the working tree.
 */
function snapshotOf(
  git: GitBinary,
  tree: string,
  list: (signal?: AbortSignal) => Promise<Listing>,
  options: TreeSnapshotOptions,
): TreeSnapshot {
  let listing: Promise<Listing> | undefined;
  const blobs = new BlobReader(git, options.maxBlobBytes ?? DEFAULT_MAX_BLOB_BYTES);

  const load = (signal?: AbortSignal): Promise<Listing> => {
    listing ??= list(signal);
    listing.catch(() => {
      listing = undefined;
    });
    return listing;
  };

  const describe = async (path: string): Promise<TargetKind> => {
    const { entries, rootExists } = await load();
    if (path === ".") {
      return rootExists ? "directory" : "missing";
    }
    return entries.get(path)?.kind ?? "missing";
  };

  return {
    tree,
    describe,
    async readText(path) {
      const entry = (await load()).entries.get(path);
      if (entry?.kind !== "file") {
        return undefined;
      }
      return (await blobs.read(entry.object))?.toString("utf8");
    },
    async listFiles(signal): Promise<FileListing> {
      const { files, truncated } = await load(signal);
      return { files, truncated };
    },
    dispose() {
      blobs.dispose();
    },
  };
}

/** Listing of index files below `prefix`; directories are implied by the file paths. */
function listIndex(files: readonly TreeFile[], prefix: string, maxEntries: number): Listing {
  const entries = new Map<string, TreeEntry>();
  const listed: string[] = [];
  const start = prefix === "" ? "" : `${prefix}/`;
  let truncated = false;
  for (const file of files) {
    const fullPath = file.path.toString("utf8");
    if (!fullPath.startsWith(start)) {
      continue;
    }
    const path = fullPath.slice(start.length);
    const segments = path.split("/");
    for (let depth = 1; depth < segments.length; depth++) {
      const directory = segments.slice(0, depth).join("/");
      if (!entries.has(directory)) {
        entries.set(directory, { kind: "directory", object: "" });
      }
    }
    if (entries.size >= maxEntries) {
      truncated = true;
      break;
    }
    const kind = kindOf(file.mode);
    entries.set(path, { kind, object: file.object });
    if (kind === "file") {
      listed.push(path);
    }
  }
  return {
    entries,
    files: listed.sort(),
    truncated,
    rootExists: prefix === "" || entries.size > 0,
  };
}

async function listTree(
  git: GitBinary,
  tree: string,
  prefix: string,
  maxEntries: number,
  signal?: AbortSignal,
): Promise<Listing> {
  const args = ["ls-tree", "-r", "-t", "-z", "--full-tree", tree];
  const output = await git.run(prefix === "" ? args : [...args, "--", prefix], { signal });
  if (output.exitCode !== 0) {
    throw new Error(`git ls-tree failed with exit code ${String(output.exitCode)}.`);
  }
  const entries = new Map<string, TreeEntry>();
  const files: string[] = [];
  const start = prefix === "" ? "" : `${prefix}/`;
  let rootExists = prefix === "";
  let truncated = false;
  for (const record of output.stdout.toString("utf8").split("\0")) {
    // <mode> SP <type> SP <object> TAB <path>
    const tab = record.indexOf("\t");
    if (tab === -1) {
      continue;
    }
    const [mode = "", , object = ""] = record.slice(0, tab).split(" ");
    const fullPath = record.slice(tab + 1);
    if (fullPath === prefix) {
      rootExists = mode === "040000";
      continue;
    }
    if (!fullPath.startsWith(start) || !OBJECT_ID.test(object)) {
      continue;
    }
    if (entries.size >= maxEntries) {
      truncated = true;
      break;
    }
    const path = fullPath.slice(start.length);
    const kind = kindOf(mode);
    entries.set(path, { kind, object });
    if (kind === "file") {
      files.push(path);
    }
  }
  return { entries, files: files.sort(), truncated, rootExists };
}

interface PendingRead {
  readonly object: string;
  readonly resolve: (content: Buffer | undefined) => void;
  readonly reject: (error: Error) => void;
}

/**
 * Reads blobs through one `git cat-file --batch` process: requests are written as object IDs,
 * one per line, and answered in order, so a thousand pages need one process, not a thousand.
 */
class BlobReader {
  private process: ChildProcessWithoutNullStreams | undefined;
  private readonly queue: PendingRead[] = [];
  private buffer: Buffer = Buffer.alloc(0);

  constructor(
    private readonly git: GitBinary,
    private readonly maxBlobBytes: number,
  ) {}

  read(object: string): Promise<Buffer | undefined> {
    return new Promise((resolve, reject) => {
      const child = this.start();
      this.queue.push({ object, resolve, reject });
      child.stdin.write(`${object}\n`);
    });
  }

  dispose(): void {
    const child = this.process;
    this.process = undefined;
    // Closing standard input ends `cat-file` normally; killing it could break a pending write.
    child?.stdin.end();
    this.fail(new Error("The snapshot was disposed."));
  }

  private start(): ChildProcessWithoutNullStreams {
    if (this.process) {
      return this.process;
    }
    const child = this.git.spawnInteractive(["cat-file", "--batch"]);
    this.process = child;
    this.buffer = Buffer.alloc(0);
    child.stdout.on("data", (chunk: Buffer) => {
      this.buffer = this.buffer.length === 0 ? chunk : Buffer.concat([this.buffer, chunk]);
      this.drain();
    });
    child.stderr.resume();
    child.stdin.on("error", () => {
      // Reported through `close`.
    });
    const end = (): void => {
      if (this.process === child) {
        this.process = undefined;
        this.fail(new Error("git cat-file ended unexpectedly."));
      }
    };
    child.on("error", end);
    child.on("close", end);
    return child;
  }

  /** Answers queued reads from the buffered output: `<id> blob <size>\n<content>\n` each. */
  private drain(): void {
    for (;;) {
      const pending = this.queue[0];
      const newline = this.buffer.indexOf(0x0a);
      if (!pending || newline === -1) {
        return;
      }
      const header = this.buffer.subarray(0, newline).toString("utf8").split(" ");
      if (header.length !== 3) {
        // `<id> missing`: no content follows.
        this.buffer = this.buffer.subarray(newline + 1);
        this.queue.shift();
        pending.resolve(undefined);
        continue;
      }
      const size = Number(header[2]);
      const end = newline + 1 + size;
      if (this.buffer.length < end + 1) {
        return;
      }
      const wanted = header[0] === pending.object && header[1] === "blob";
      const content =
        !wanted || size > this.maxBlobBytes ? undefined : this.buffer.subarray(newline + 1, end);
      this.buffer = this.buffer.subarray(end + 1);
      this.queue.shift();
      pending.resolve(content && Buffer.from(content));
    }
  }

  private fail(error: Error): void {
    for (const pending of this.queue.splice(0)) {
      pending.reject(error);
    }
  }
}
