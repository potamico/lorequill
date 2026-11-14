import { existsSync, readFileSync } from "node:fs";
import { chmod, mkdir, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { GitBinary, gitEnvironment } from "../../src/core/git/git-process";
import {
  commitsSince,
  contentPrefix,
  findRepositoryRoot,
  readCommitTree,
  readHead,
  readIndex,
  resetBranchToRemote,
} from "../../src/core/git/repository";
import {
  createIndexSnapshot,
  createTreeSnapshot,
  type TreeSnapshot,
} from "../../src/core/git/tree-snapshot";
import { createRepository, type DisposableRepository } from "./git-fixture";

const posixOnly = it.skipIf(process.platform === "win32");

let repositories: DisposableRepository[] = [];
let snapshots: TreeSnapshot[] = [];

async function repository(): Promise<DisposableRepository> {
  const created = await createRepository();
  repositories.push(created);
  return created;
}

/** The staged snapshot of `repo` below `prefix`. */
async function staged(repo: DisposableRepository, prefix = ""): Promise<TreeSnapshot> {
  const git = new GitBinary("git", repo.root);
  const index = await readIndex(git);
  if (index.kind !== "tree") {
    throw new Error("conflicted index");
  }
  const snapshot = createIndexSnapshot(git, index, prefix);
  snapshots.push(snapshot);
  return snapshot;
}

afterEach(async () => {
  for (const snapshot of snapshots) {
    snapshot.dispose();
  }
  snapshots = [];
  for (const repo of repositories) {
    await repo.dispose();
  }
  repositories = [];
});

describe("gitEnvironment", () => {
  it("drops every GIT_ variable and keeps reads non-interactive", () => {
    const environment = gitEnvironment({
      PATH: "/bin",
      GIT_DIR: "/elsewhere/.git",
      GIT_INDEX_FILE: "/tmp/index",
      git_work_tree: "/x",
    });
    expect(environment).toEqual({
      PATH: "/bin",
      GIT_TERMINAL_PROMPT: "0",
      GIT_OPTIONAL_LOCKS: "0",
      GIT_LITERAL_PATHSPECS: "1",
      LC_ALL: "C",
    });
  });
});

describe("staged snapshot", () => {
  it("excludes unstaged changes and untracked files", async () => {
    const repo = await repository();
    await repo.commit({ "docs/a.md": "# A\n" });
    await repo.write("docs/a.md", "# A, unstaged\n");
    await repo.write("docs/new.md", "# Untracked\n");

    const snapshot = await staged(repo, "docs");
    expect(await snapshot.readText("a.md")).toBe("# A\n");
    expect(await snapshot.describe("new.md")).toBe("missing");
    expect(await snapshot.listFiles()).toEqual({ files: ["a.md"], truncated: false });
  });

  it("includes pre-staged additions and modifications merged with unchanged HEAD content", async () => {
    const repo = await repository();
    await repo.commit({ "docs/a.md": "# A\n", "docs/b.md": "# B\n" });
    await repo.write("docs/a.md", "# A, staged\n");
    await repo.write("docs/c.md", "# C, staged\n");
    repo.git(["add", "docs/a.md", "docs/c.md"]);

    const snapshot = await staged(repo, "docs");
    expect(await snapshot.readText("a.md")).toBe("# A, staged\n");
    expect(await snapshot.readText("b.md")).toBe("# B\n");
    expect(await snapshot.readText("c.md")).toBe("# C, staged\n");
  });

  it("reads the staged version of a partially staged file", async () => {
    const repo = await repository();
    await repo.commit({ "page.md": "one\n" });
    await repo.write("page.md", "one\ntwo\n");
    repo.git(["add", "page.md"]);
    await repo.write("page.md", "one\ntwo\nthree, not staged\n");

    expect(await (await staged(repo)).readText("page.md")).toBe("one\ntwo\n");
  });

  it("validates a staged deletion, but not an unstaged one", async () => {
    const repo = await repository();
    await repo.commit({ "docs/gone.md": "# Gone\n", "docs/kept.md": "# Kept\n" });
    repo.git(["rm", "-q", "docs/gone.md"]);
    await repo.remove("docs/kept.md");

    const snapshot = await staged(repo, "docs");
    expect(await snapshot.describe("gone.md")).toBe("missing");
    expect(await snapshot.readText("kept.md")).toBe("# Kept\n");
  });

  it("does not change when the index changes later", async () => {
    const repo = await repository();
    await repo.commit({ "page.md": "first\n" });
    const snapshot = await staged(repo);
    await repo.write("page.md", "second\n");
    repo.git(["add", "page.md"]);

    expect(await snapshot.readText("page.md")).toBe("first\n");
    expect((await staged(repo)).tree).not.toBe(snapshot.tree);
  });

  it("reads many blobs through one process, concurrently and in order", async () => {
    const repo = await repository();
    const files = Object.fromEntries(
      Array.from({ length: 200 }, (_, index) => [`p/${String(index)}.md`, `# ${String(index)}\n`]),
    );
    await repo.commit(files);
    const snapshot = await staged(repo, "p");
    const texts = await Promise.all(
      Array.from({ length: 200 }, (_, index) => snapshot.readText(`${String(index)}.md`)),
    );
    expect(texts).toEqual(Array.from({ length: 200 }, (_, index) => `# ${String(index)}\n`));
    // Writing and committing 200 files takes several seconds with Git for Windows.
  }, 30_000);

  it("keeps everything outside the content root out of reach", async () => {
    const repo = await repository();
    await repo.commit({ "README.md": "# Root\n", "docs/a.md": "# A\n", "docs2/b.md": "# B\n" });

    const snapshot = await staged(repo, "docs");
    expect((await snapshot.listFiles()).files).toEqual(["a.md"]);
    expect(await snapshot.readText("../README.md")).toBeUndefined();
    expect(await snapshot.describe("../docs2/b.md")).toBe("missing");
    expect(await snapshot.describe(".")).toBe("directory");
  });

  // `*` is not allowed in Windows file names.
  posixOnly("treats a pathspec-like content root literally", async () => {
    const repo = await repository();
    await repo.commit({ "do*s/a.md": "# A\n", "docs/b.md": "# B\n" });
    expect((await (await staged(repo, "do*s")).listFiles()).files).toEqual(["a.md"]);
  });

  it("describes directories, a missing content root, and exact name case", async () => {
    const repo = await repository();
    await repo.commit({ "docs/guide/Setup.md": "# Setup\n" });

    const snapshot = await staged(repo, "docs");
    expect(await snapshot.describe("guide")).toBe("directory");
    expect(await snapshot.describe("guide/Setup.md")).toBe("file");
    expect(await snapshot.describe("guide/setup.md")).toBe("missing");
    expect(await (await staged(repo, "elsewhere")).describe(".")).toBe("missing");
  });

  posixOnly("does not follow symbolic links", async () => {
    const repo = await repository();
    await repo.write("outside.md", "# Secret\n");
    await mkdir(join(repo.root, "docs"));
    await symlink("../outside.md", join(repo.root, "docs", "link.md"));
    repo.git(["add", "."]);

    const snapshot = await staged(repo, "docs");
    expect(await snapshot.describe("link.md")).toBe("unsupported");
    expect(await snapshot.readText("link.md")).toBeUndefined();
    expect((await snapshot.listFiles()).files).toEqual([]);
  });

  it("reports an incomplete listing at the entry limit", async () => {
    const repo = await repository();
    await repo.commit({ "a.md": "a", "b.md": "b", "c.md": "c" });
    const git = new GitBinary("git", repo.root);
    const snapshot = createTreeSnapshot(git, await readCommitTree(git, "HEAD"), "", {
      maxEntries: 2,
    });
    snapshots.push(snapshot);
    expect((await snapshot.listFiles()).truncated).toBe(true);
  });

  it("does not read blobs above the size limit", async () => {
    const repo = await repository();
    await repo.commit({ "big.md": "x".repeat(100), "small.md": "y" });
    const git = new GitBinary("git", repo.root);
    const snapshot = createTreeSnapshot(git, await readCommitTree(git, "HEAD"), "", {
      maxBlobBytes: 10,
    });
    snapshots.push(snapshot);
    expect(await snapshot.readText("big.md")).toBeUndefined();
    expect(await snapshot.readText("small.md")).toBe("y");
  });

  it("handles file names with shell syntax as plain names", async () => {
    const repo = await repository();
    const name = "$(touch pwned); `id` & echo.md";
    await repo.commit({ [`docs/${name}`]: "# Odd\n" });
    const snapshot = await staged(repo, "docs");
    expect(await snapshot.readText(name)).toBe("# Odd\n");
    expect(existsSync(join(repo.root, "pwned"))).toBe(false);
  });

  posixOnly("runs no repository hooks or file system monitor", async () => {
    const repo = await repository();
    await repo.commit({ "page.md": "# Page\n" });
    const marker = join(repo.root, "ran");
    const script = join(repo.root, ".git", "evil.sh");
    await writeFile(script, `#!/bin/sh\necho "$*" >> "${marker}"\n`);
    await chmod(script, 0o755);
    for (const hook of ["post-index-change", "reference-transaction", "post-checkout"]) {
      await writeFile(join(repo.root, ".git", "hooks", hook), `#!/bin/sh\n"${script}" ${hook}\n`);
      await chmod(join(repo.root, ".git", "hooks", hook), 0o755);
    }
    repo.git(["config", "core.fsmonitor", script]);
    await repo.write(".gitattributes", "*.md filter=evil\n");
    repo.git(["config", "filter.evil.smudge", script]);
    repo.git(["config", "filter.evil.clean", script]);

    const git = new GitBinary("git", repo.root);
    await readHead(git);
    const snapshot = await staged(repo);
    expect(await snapshot.readText("page.md")).toBe("# Page\n");
    // The commit right before makes the entry racily clean, which makes an index write re-read
    // the file through its clean filter; reading the index must not do that.
    expect(existsSync(marker) ? readFileSync(marker, "utf8") : "").toBe("");
  });
});

describe("index tree identity", () => {
  /** What `git write-tree` prints for the current index, written by Git itself. */
  function writeTree(repo: DisposableRepository): string {
    return repo.git(["write-tree"]);
  }

  it("matches git write-tree for tricky names, modes, and nesting", async () => {
    const repo = await repository();
    await repo.commit({
      "a.md": "1",
      "a-b.md": "2",
      "a/b.md": "3",
      "a.b/c.md": "4",
      a0: "5",
      "Z.md": "6",
      "ü/ñ.md": "7",
      "deep/x/y/z.md": "8",
      "space name.md": "9",
    });
    await repo.write("run.sh", "#!/bin/sh\n");
    repo.git(["add", "run.sh"]);
    repo.git(["update-index", "--chmod=+x", "run.sh"]);
    const index = await readIndex(new GitBinary("git", repo.root));
    expect(index.kind === "tree" && index.tree).toBe(writeTree(repo));
  });

  posixOnly("matches git write-tree for symbolic links and submodules", async () => {
    const repo = await repository();
    await repo.commit({ "a.md": "a" });
    await symlink("a.md", join(repo.root, "link"));
    repo.git(["add", "link"]);
    repo.git([
      "update-index",
      "--add",
      "--cacheinfo",
      `160000,${repo.git(["rev-parse", "HEAD"])},sub`,
    ]);
    const index = await readIndex(new GitBinary("git", repo.root));
    expect(index.kind === "tree" && index.tree).toBe(writeTree(repo));
  });

  it("gives the empty tree for an empty index", async () => {
    const repo = await repository();
    const index = await readIndex(new GitBinary("git", repo.root));
    expect(index).toEqual({ kind: "tree", tree: writeTree(repo), files: [] });
  });

  it("leaves out intent-to-add entries, as a commit does", async () => {
    const repo = await repository();
    await repo.commit({ "a.md": "a" });
    await repo.write("later.md", "not staged");
    repo.git(["add", "--intent-to-add", "later.md"]);
    const git = new GitBinary("git", repo.root);
    const index = await readIndex(git);
    expect(index.kind === "tree" && index.tree).toBe(await readCommitTree(git, "HEAD"));
    if (index.kind === "tree") {
      const snapshot = createIndexSnapshot(git, index, "");
      snapshots.push(snapshot);
      expect(await snapshot.describe("later.md")).toBe("missing");
    }
  });

  it("writes nothing to the repository", async () => {
    const repo = await repository();
    await repo.commit({ "a.md": "a" });
    await repo.write("b.md", "b");
    repo.git(["add", "b.md"]);
    const index = await readIndex(new GitBinary("git", repo.root));
    const tree = index.kind === "tree" ? index.tree : "";
    expect(() => repo.git(["cat-file", "-e", tree])).toThrow();
  });

  it("reads a commit tree as a snapshot", async () => {
    const repo = await repository();
    await repo.commit({ "docs/a.md": "# A\n" });
    await repo.write("docs/a.md", "# Changed\n");
    repo.git(["add", "docs/a.md"]);
    const git = new GitBinary("git", repo.root);
    const snapshot = createTreeSnapshot(git, await readCommitTree(git, "HEAD"), "docs");
    snapshots.push(snapshot);
    expect(await snapshot.readText("a.md")).toBe("# A\n");
    expect(await snapshot.describe(".")).toBe("directory");
    expect((await snapshot.listFiles()).files).toEqual(["a.md"]);
  });
});

describe("repository state", () => {
  it("reads a branch, an unborn branch, and a detached HEAD", async () => {
    const repo = await repository();
    const git = new GitBinary("git", repo.root);
    expect(await readHead(git)).toEqual({ kind: "unborn", branch: "main" });

    const first = await repo.commit({ "a.md": "a" });
    expect(await readHead(git)).toEqual({ kind: "branch", branch: "main", commit: first });

    repo.git(["checkout", "-q", "-b", "feature/x"]);
    const second = await repo.commit({ "b.md": "b" });
    expect(await readHead(git)).toEqual({ kind: "branch", branch: "feature/x", commit: second });

    repo.git(["checkout", "-q", "--detach", first]);
    expect(await readHead(git)).toEqual({ kind: "detached", commit: first });
  });

  it("stages files on an unborn branch into a snapshot", async () => {
    const repo = await repository();
    await repo.write("a.md", "# A\n");
    repo.git(["add", "a.md"]);
    expect(await (await staged(repo)).readText("a.md")).toBe("# A\n");
  });

  it("follows the checked-out branch", async () => {
    const repo = await repository();
    await repo.commit({ "a.md": "main\n" });
    repo.git(["checkout", "-q", "-b", "other"]);
    await repo.commit({ "a.md": "other\n" });
    expect(await (await staged(repo)).readText("a.md")).toBe("other\n");
    repo.git(["checkout", "-q", "main"]);
    expect(await (await staged(repo)).readText("a.md")).toBe("main\n");
  });

  it("gives the index tree of a fresh commit as that commit's tree", async () => {
    const repo = await repository();
    await repo.write("a.md", "a");
    repo.git(["add", "a.md"]);
    const git = new GitBinary("git", repo.root);
    const before = await readIndex(git);
    repo.git(["commit", "-q", "-m", "c"]);
    expect(before.kind === "tree" && before.tree).toBe(await readCommitTree(git, "HEAD"));
  });

  it("reports a conflicted index instead of a tree", async () => {
    const repo = await repository();
    await repo.commit({ "a.md": "base\n" });
    repo.git(["checkout", "-q", "-b", "other"]);
    await repo.commit({ "a.md": "other\n" });
    repo.git(["checkout", "-q", "main"]);
    await repo.commit({ "a.md": "main\n" });
    try {
      repo.git(["merge", "-q", "other"]);
    } catch {
      // The merge stops with a conflict, as intended.
    }
    expect(await readIndex(new GitBinary("git", repo.root))).toEqual({
      kind: "conflicted",
      paths: ["a.md"],
    });
  });
});

describe("repository boundaries", () => {
  it("resolves the innermost repository and the content root inside it", async () => {
    const outer = await repository();
    await outer.commit({ "README.md": "outer" });
    const inner = await createRepository({ parent: outer.root, name: "nested" });
    await inner.commit({ "docs/a.md": "# Inner\n" });

    const contentRoot = join(inner.root, "docs");
    expect(await findRepositoryRoot("git", contentRoot)).toBe(inner.root);
    expect(await findRepositoryRoot("git", outer.root)).toBe(outer.root);
    expect(await contentPrefix(inner.root, contentRoot)).toBe("docs");
    expect(await contentPrefix(inner.root, inner.root)).toBe("");
    expect(await contentPrefix(inner.root, outer.root)).toBeUndefined();

    // The outer repository's index never exposes the nested repository's files.
    outer.git(["add", "-A"]);
    const snapshot = await staged(outer, "nested/docs");
    expect((await snapshot.listFiles()).files).toEqual([]);
  });

  it("finds no repository outside a work tree", async () => {
    const repo = await repository();
    expect(await findRepositoryRoot("git", join(repo.root, ".git"))).toBeUndefined();
  });
});

describe("commitsSince", () => {
  it("lists the branch's commits relative to the remote base branch", async () => {
    const remote = await repository();
    remote.git(["config", "receive.denyCurrentBranch", "ignore"]);
    const repo = await repository();
    await repo.commit({ "a.md": "a" }, "base");
    repo.git(["remote", "add", "origin", remote.root]);
    repo.git(["push", "-q", "origin", "main"]);
    repo.git(["checkout", "-q", "-b", "feature"]);
    await repo.commit({ "b.md": "b" }, "first page");
    await repo.commit({ "c.md": "c" }, "second page");

    const git = new GitBinary("git", repo.root);
    const listed = await commitsSince(git, "origin", "main");
    expect(listed?.commits.map(({ subject }) => subject)).toEqual(["second page", "first page"]);
    expect(listed?.truncated).toBe(false);
    expect(await commitsSince(git, "origin", "missing")).toBeUndefined();
    expect(await commitsSince(git, "origin", "main..HEAD")).toBeUndefined();
    expect(await commitsSince(git, "-x", "main")).toBeUndefined();
  });
});

describe("resetBranchToRemote", () => {
  it("moves the base branch back to the remote once its commits are on another branch", async () => {
    const remote = await repository();
    remote.git(["config", "receive.denyCurrentBranch", "ignore"]);
    const repo = await repository();
    await repo.commit({ "a.md": "a" }, "base");
    repo.git(["remote", "add", "origin", remote.root]);
    repo.git(["push", "-q", "origin", "main"]);
    const pushed = repo.git(["rev-parse", "main"]).trim();
    await repo.commit({ "b.md": "b" }, "on main");
    const tip = repo.git(["rev-parse", "main"]).trim();
    const git = new GitBinary("git", repo.root);

    // Not while the commits are on no other branch.
    expect(await resetBranchToRemote(git, "main", "origin", "missing", tip)).toBe(false);
    repo.git(["checkout", "-q", "-b", "carrier"]);
    // Not when main moved in the meantime.
    expect(await resetBranchToRemote(git, "main", "origin", "carrier", pushed)).toBe(false);
    expect(await resetBranchToRemote(git, "-x", "origin", "carrier", tip)).toBe(false);
    expect(repo.git(["rev-parse", "main"]).trim()).toBe(tip);

    expect(await resetBranchToRemote(git, "main", "origin", "carrier", tip)).toBe(true);
    expect(repo.git(["rev-parse", "main"]).trim()).toBe(pushed);
    expect(repo.git(["rev-parse", "carrier"]).trim()).toBe(tip);
    expect(repo.git(["reflog", "-1", "--format=%gs", "main"]).trim()).toBe(
      "lorequill: commits moved to carrier",
    );
    // Many Git processes, which are slow on Windows runners.
  }, 30_000);
});
