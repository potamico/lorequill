import { createHash } from "node:crypto";

/** Hash algorithm of a repository's objects (`extensions.objectFormat`). */
export type ObjectFormat = "sha1" | "sha256";

/** A file in a tree: its Git mode, object ID, and path as raw bytes (`/`-separated). */
export interface TreeFile {
  readonly mode: string;
  readonly object: string;
  readonly path: Buffer;
}

interface Directory {
  readonly files: Map<
    string,
    { readonly name: Buffer; readonly mode: string; readonly object: string }
  >;
  readonly directories: Map<string, { readonly name: Buffer; readonly directory: Directory }>;
}

const SLASH = 0x2f;

function emptyDirectory(): Directory {
  return { files: new Map(), directories: new Map() };
}

/**
 * The ID Git gives the tree that contains exactly `files` (the result of `git write-tree` for an
 * index with these entries), computed without writing anything. A tree object is the sequence
 * of `<mode> <name>\0<raw object id>` entries sorted by name, where a directory name sorts as if
 * it ended in `/`; directories use mode `40000`. The object ID is the hash of
 * `tree <length>\0<entries>`.
 */
export function computeTreeId(files: Iterable<TreeFile>, format: ObjectFormat): string {
  const root = emptyDirectory();
  for (const file of files) {
    let directory = root;
    let start = 0;
    for (
      let slash = file.path.indexOf(SLASH);
      slash !== -1;
      slash = file.path.indexOf(SLASH, start)
    ) {
      const name = file.path.subarray(start, slash);
      const key = name.toString("latin1");
      let child = directory.directories.get(key);
      if (!child) {
        child = { name, directory: emptyDirectory() };
        directory.directories.set(key, child);
      }
      directory = child.directory;
      start = slash + 1;
    }
    const name = file.path.subarray(start);
    directory.files.set(name.toString("latin1"), { name, mode: file.mode, object: file.object });
  }
  return hashDirectory(root, format);
}

function hashDirectory(directory: Directory, format: ObjectFormat): string {
  const entries: { readonly key: Buffer; readonly bytes: Buffer }[] = [];
  for (const { name, mode, object } of directory.files.values()) {
    entries.push({ key: name, bytes: entry(mode, name, object) });
  }
  for (const { name, directory: child } of directory.directories.values()) {
    entries.push({
      key: Buffer.concat([name, Buffer.from("/")]),
      bytes: entry("40000", name, hashDirectory(child, format)),
    });
  }
  // Byte order with the implied trailing `/` of directories; names never contain NUL, so a
  // shorter name that is a prefix of a longer one sorts first, as in Git.
  entries.sort((a, b) => Buffer.compare(a.key, b.key));
  const body = Buffer.concat(entries.map(({ bytes }) => bytes));
  return createHash(format)
    .update(Buffer.from(`tree ${String(body.length)}\0`))
    .update(body)
    .digest("hex");
}

function entry(mode: string, name: Buffer, object: string): Buffer {
  return Buffer.concat([
    Buffer.from(`${mode} `),
    name,
    Buffer.from([0]),
    Buffer.from(object, "hex"),
  ]);
}
