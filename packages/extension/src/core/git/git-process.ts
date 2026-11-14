import { spawn, type ChildProcess, type ChildProcessWithoutNullStreams } from "node:child_process";
import type { Readable } from "node:stream";

/** Output of a finished Git command. */
export interface GitOutput {
  readonly exitCode: number;
  readonly stdout: Buffer;
  readonly stderr: string;
}

export interface GitRunOptions {
  /** Text written to standard input, which is then closed. */
  readonly input?: string;
  readonly signal?: AbortSignal | undefined;
  /** Standard output beyond this many bytes fails the command. */
  readonly maxOutputBytes?: number;
  /** The command is cancelled after this time; 30 seconds by default. */
  readonly timeoutMs?: number;
}

/** A Git command failed, was cancelled, or produced more output than allowed. */
export class GitError extends Error {
  constructor(
    message: string,
    readonly args: readonly string[],
    readonly exitCode?: number,
    readonly stderr = "",
  ) {
    super(message);
    this.name = "GitError";
  }
}

const DEFAULT_MAX_OUTPUT_BYTES = 64 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * Options placed before every subcommand. A file system monitor configured in the repository
 * would run a program for index reads, so it is switched off; Lorequill never needs one.
 */
const GLOBAL_OPTIONS = ["-c", "core.fsmonitor=false", "-c", "core.quotePath=false"];

/**
 * The environment of Git processes: the extension host's environment without any `GIT_*`
 * variable, so nothing redirects the repository, index, object store, or configuration, plus
 * settings that keep reads side-effect free and non-interactive. Pathspecs are literal, so a
 * content root named `docs*` matches only itself.
 */
export function gitEnvironment(base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {};
  for (const [name, value] of Object.entries(base)) {
    if (!name.toUpperCase().startsWith("GIT_")) {
      environment[name] = value;
    }
  }
  return {
    ...environment,
    GIT_TERMINAL_PROMPT: "0",
    GIT_OPTIONAL_LOCKS: "0",
    GIT_LITERAL_PATHSPECS: "1",
    LC_ALL: "C",
  };
}

/**
 * The Git binary bound to one working directory (specification §5). Every command is an
 * argument array passed to the executable directly, never through a shell, so no argument is
 * ever interpreted as shell syntax.
 */
export class GitBinary {
  constructor(
    /** Executable reported by the VS Code Git extension, or `git` in tests. */
    readonly path: string,
    /** Absolute directory the commands run in; the caller has verified it. */
    readonly cwd: string,
  ) {}

  /** Runs `git <args>` and resolves with its output, whatever the exit code. */
  run(args: readonly string[], options: GitRunOptions = {}): Promise<GitOutput> {
    const maxOutputBytes = options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
    const timeout = AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
    return new Promise((resolve, reject) => {
      if (signal.aborted) {
        reject(new GitError("Git command cancelled.", args));
        return;
      }
      const child = this.spawn(args, options.input !== undefined);
      const chunks: Buffer[] = [];
      let size = 0;
      let stderr = "";
      let failure: GitError | undefined;
      const stop = (error: GitError): void => {
        failure ??= error;
        child.kill();
      };
      const onAbort = (): void => {
        stop(new GitError("Git command cancelled.", args));
      };
      signal.addEventListener("abort", onAbort, { once: true });
      child.stdout.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > maxOutputBytes) {
          stop(new GitError("Git output exceeds its limit.", args));
        } else {
          chunks.push(chunk);
        }
      });
      child.stderr.setEncoding("utf8");
      child.stderr.on("data", (chunk: string) => {
        if (stderr.length < 64 * 1024) {
          stderr += chunk;
        }
      });
      child.on("error", (error) => {
        stop(new GitError(`Git could not be started: ${error.message}`, args));
      });
      child.on("close", (code) => {
        signal.removeEventListener("abort", onAbort);
        if (failure) {
          reject(failure);
        } else {
          resolve({ exitCode: code ?? -1, stdout: Buffer.concat(chunks), stderr });
        }
      });
      if (child.stdin) {
        child.stdin.on("error", () => {
          // The process exited before reading its input; the exit code reports why.
        });
        child.stdin.end(options.input);
      }
    });
  }

  /** Runs `git <args>`, requires exit code 0, and returns standard output as trimmed text. */
  async text(args: readonly string[], options: GitRunOptions = {}): Promise<string> {
    const output = await this.run(args, options);
    if (output.exitCode !== 0) {
      throw new GitError(
        `git ${args[0] ?? ""} failed with exit code ${String(output.exitCode)}.`,
        args,
        output.exitCode,
        output.stderr,
      );
    }
    return output.stdout.toString("utf8").trim();
  }

  /** Starts a long-running Git process that reads requests from standard input. */
  spawnInteractive(args: readonly string[]): ChildProcessWithoutNullStreams {
    return spawn(this.path, [...GLOBAL_OPTIONS, ...args], {
      cwd: this.cwd,
      env: gitEnvironment(),
      shell: false,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
  }

  /** Starts a command; standard input is a pipe only if there is input to write. */
  private spawn(
    args: readonly string[],
    withInput: boolean,
  ): ChildProcess & {
    stdout: Readable;
    stderr: Readable;
  } {
    return spawn(this.path, [...GLOBAL_OPTIONS, ...args], {
      cwd: this.cwd,
      env: gitEnvironment(),
      shell: false,
      windowsHide: true,
      stdio: [withInput ? "pipe" : "ignore", "pipe", "pipe"],
    }) as ChildProcess & { stdout: Readable; stderr: Readable };
  }
}
