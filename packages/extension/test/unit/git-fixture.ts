import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { gitEnvironment } from "../../src/core/git/git-process";

/**
 * A disposable local Git repository for tests. It has its own
 * identity and no signing, hooks, or global configuration from the machine running the tests.
 */
export interface DisposableRepository {
  /** Real path of the work tree. */
  readonly root: string;
  /** Runs Git in the work tree (or `cwd` below it) and returns trimmed standard output. */
  git(args: readonly string[], cwd?: string): string;
  /** Writes a file, creating its directories; `path` is relative to the work tree. */
  write(path: string, text: string): Promise<void>;
  remove(path: string): Promise<void>;
  /** Writes, stages, and commits the given files. */
  commit(files: Readonly<Record<string, string>>, message?: string): Promise<string>;
  dispose(): Promise<void>;
}

const ISOLATED_CONFIG = {
  // Not os.devNull, which is \\.\nul on Windows: Git for Windows cannot open it, but maps "/dev/null".
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
};

export async function createRepository(
  options: { readonly parent?: string; readonly name?: string } = {},
): Promise<DisposableRepository> {
  const parent = options.parent ?? (await realpath(await mkdtemp(join(tmpdir(), "lq-git-"))));
  const root = options.name ? join(parent, options.name) : parent;
  await mkdir(root, { recursive: true });
  const run = (args: readonly string[], cwd = root): string =>
    execFileSync("git", args, {
      cwd,
      env: { ...gitEnvironment(), ...ISOLATED_CONFIG },
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  run(["init", "-q", "-b", "main"]);
  run(["config", "user.name", "Lorequill Test"]);
  run(["config", "user.email", "test@example.invalid"]);
  run(["config", "commit.gpgsign", "false"]);
  run(["config", "core.autocrlf", "false"]);

  const write = async (path: string, text: string): Promise<void> => {
    const file = join(root, ...path.split("/"));
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, text);
  };
  return {
    root,
    git: run,
    write,
    remove: (path) => rm(join(root, ...path.split("/")), { recursive: true, force: true }),
    async commit(files, message = "test commit") {
      for (const [path, text] of Object.entries(files)) {
        await write(path, text);
      }
      run(["add", "--", ...Object.keys(files)]);
      run(["commit", "-q", "--no-verify", "-m", message]);
      return run(["rev-parse", "HEAD"]);
    },
    dispose: () =>
      // Windows keeps a directory busy until every Git process started in it has exited.
      options.parent
        ? Promise.resolve()
        : rm(parent, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }),
  };
}
