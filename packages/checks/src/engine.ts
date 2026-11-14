import { createHash } from "node:crypto";
import { posix } from "node:path";
import { setImmediate as yieldToEventLoop } from "node:timers/promises";
import {
  createContentScope,
  DEFAULT_CHECK_TIMEOUT_SECONDS,
  type CheckRule,
  type Profile,
} from "@lorequill/profile";
import {
  createAnchorCache,
  createPage,
  type FindingInput,
  type Page,
  type RuleContext,
} from "./context";
import { compareFindings, compareStrings, formatMessage, type Finding } from "./findings";
import { checkFieldFormat, checkUniqueField } from "./rules/field-rules";
import { checkReferenceField } from "./rules/reference-field";
import { checkRelativeLinks } from "./rules/relative-links";
import { checkAllowValues, checkForbiddenText } from "./rules/text-rules";
import type { ContentSnapshot } from "./snapshot";
import { ENGINE_VERSION } from "./version";

/** Resource limits of a run (specification §15). Exceeding one makes the run incomplete. */
export interface CheckLimits {
  /** Largest page that is checked, in UTF-16 code units (about bytes for most text). */
  readonly maxPageLength: number;
  /** The run stops after this many findings. */
  readonly maxFindings: number;
}

export const DEFAULT_LIMITS: CheckLimits = {
  maxPageLength: 4 * 1024 * 1024,
  maxFindings: 10_000,
};

export interface RunOptions {
  readonly profile: Profile;
  readonly snapshot: ContentSnapshot;
  /** Cancels the run, for example when a newer document version arrives. */
  readonly signal?: AbortSignal;
  readonly limits?: Partial<CheckLimits>;
  /**
   * Keeps parsed pages between runs, so a run after editing one page parses only that page
   * (specification §15). Pass the same cache to consecutive runs of one content root.
   */
  readonly cache?: RunCache;
}

/** Parsed pages from earlier runs, keyed by path; an entry is reused only for identical text. */
export interface RunCache {
  readonly pages: Map<string, Page>;
}

export function createRunCache(): RunCache {
  return { pages: new Map() };
}

/** Why a run did not complete. A run that did not complete never counts as passed. */
export type RunErrorCode =
  | "timeout"
  | "cancelled"
  | "too-many-files"
  | "page-too-large"
  | "too-many-findings"
  | "unreadable";

export interface CheckResult {
  /**
   * `passed`: complete, no findings. `failed`: complete, with findings. `error`: incomplete
   * (timeout, cancellation, limit, unreadable file); the findings found so far are included.
   */
  readonly status: "passed" | "failed" | "error";
  readonly findings: readonly Finding[];
  readonly error?: { readonly code: RunErrorCode; readonly path?: string };
  readonly engineVersion: string;
  /**
   * Identifies the checked content: a SHA-256 over the listed file paths and every text the run
   * read. Identical bytes, profile, and engine version give identical findings (§11).
   */
  readonly snapshotId: string;
  readonly pagesChecked: number;
}

class RunAborted extends Error {
  constructor(
    readonly code: RunErrorCode,
    readonly path?: string,
  ) {
    super(code);
  }
}

const MARKDOWN_PAGE = /\.md$/i;

/**
 * Runs the checks of a profile against a snapshot (specification §11). Pure with respect to the
 * repository: it reads through the snapshot, never writes, and never executes repository code.
 */
export async function runChecks(options: RunOptions): Promise<CheckResult> {
  const { profile } = options;
  const limits = { ...DEFAULT_LIMITS, ...options.limits };
  const timeoutMs = (profile.checks?.timeout_seconds ?? DEFAULT_CHECK_TIMEOUT_SECONDS) * 1000;
  const timeout = AbortSignal.timeout(timeoutMs);
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;

  const recorder = createRecorder(options.snapshot);
  const snapshot = recorder.snapshot;
  const contentRoot = profile.content.root;
  const repositoryPath = (path: string): string =>
    contentRoot === "." ? path : posix.join(contentRoot, path);

  const findings: Finding[] = [];
  const pages: Page[] = [];

  const checkpoint = async (): Promise<void> => {
    await yieldToEventLoop();
    if (signal.aborted) {
      throw new RunAborted(timeout.aborted ? "timeout" : "cancelled");
    }
  };

  try {
    await checkpoint();
    const listing = await snapshot.listFiles(signal);
    // Sorted here, whatever the snapshot returns, so iteration and duplicate reporting are
    // deterministic (specification §11).
    const files = [...listing.files].sort(compareStrings);
    recorder.recordListing(files);
    if (listing.truncated) {
      throw new RunAborted("too-many-files");
    }

    const scope = createContentScope(profile.content);
    for (const path of files) {
      if (!MARKDOWN_PAGE.test(path) || !scope.isIncluded(path)) {
        continue;
      }
      await checkpoint();
      const text = await snapshot.readText(path);
      if (text === undefined) {
        throw new RunAborted("unreadable", repositoryPath(path));
      }
      if (text.length > limits.maxPageLength) {
        throw new RunAborted("page-too-large", repositoryPath(path));
      }
      const cached = options.cache?.pages.get(path);
      pages.push(cached?.text === text ? cached : createPage(path, text));
    }
    if (options.cache) {
      options.cache.pages.clear();
      for (const page of pages) {
        options.cache.pages.set(page.path, page);
      }
    }

    const anchorsOf = createAnchorCache(pages, snapshot);
    for (const rule of profile.checks?.rules ?? []) {
      const report = (input: FindingInput): void => {
        if (findings.length >= limits.maxFindings) {
          throw new RunAborted("too-many-findings");
        }
        findings.push({
          ruleId: rule.id,
          rule: rule.rule,
          severity: "error",
          code: input.code,
          params: input.params,
          message: formatMessage(input.code, input.params),
          path: repositoryPath(input.path),
          line: input.line,
          ...(input.column === undefined ? {} : { column: input.column }),
          ...(input.endLine === undefined ? {} : { endLine: input.endLine }),
          ...(input.endColumn === undefined ? {} : { endColumn: input.endColumn }),
        });
      };
      const context: RuleContext = {
        pages,
        snapshot,
        report,
        isDraft: (path) => scope.isDraft(path),
        repositoryPath,
        anchorsOf,
        checkpoint,
      };
      await runRule(rule, context);
    }
  } catch (error) {
    if (!(error instanceof RunAborted)) {
      throw error;
    }
    return result("error", findings, recorder.snapshotId(), pages.length, error);
  }
  return result(
    findings.length === 0 ? "passed" : "failed",
    findings,
    recorder.snapshotId(),
    pages.length,
  );
}

async function runRule(rule: CheckRule, context: RuleContext): Promise<void> {
  switch (rule.rule) {
    case "relative-links":
      await checkRelativeLinks(rule, context);
      return;
    case "forbidden-text":
      await checkForbiddenText(rule, context);
      return;
    case "unique-field":
      await checkUniqueField(rule, context);
      return;
    case "allow-values":
      await checkAllowValues(rule, context);
      return;
    case "field-format":
      await checkFieldFormat(rule, context);
      return;
    case "reference-field":
      await checkReferenceField(rule, context);
      return;
  }
}

function result(
  status: CheckResult["status"],
  findings: Finding[],
  snapshotId: string,
  pagesChecked: number,
  error?: RunAborted,
): CheckResult {
  return {
    status,
    findings: [...findings].sort(compareFindings),
    ...(error
      ? { error: { code: error.code, ...(error.path === undefined ? {} : { path: error.path }) } }
      : {}),
    engineVersion: ENGINE_VERSION,
    snapshotId,
    pagesChecked,
  };
}

/**
 * Wraps a snapshot so that the listing and every text read contribute to the snapshot identifier.
 * Reads are hashed in path order, so the identifier does not depend on the order of reads.
 */
function createRecorder(base: ContentSnapshot): {
  readonly snapshot: ContentSnapshot;
  recordListing(files: readonly string[]): void;
  snapshotId(): string;
} {
  let listed: readonly string[] = [];
  const reads = new Map<string, string>();
  return {
    snapshot: {
      describe: (path) => base.describe(path),
      async readText(path) {
        const text = await base.readText(path);
        if (text !== undefined && !reads.has(path)) {
          reads.set(path, createHash("sha256").update(text).digest("hex"));
        }
        return text;
      },
      listFiles: (signal) => base.listFiles(signal),
    },
    recordListing(files) {
      listed = files;
    },
    snapshotId() {
      const hash = createHash("sha256");
      hash.update(`files\u0000${listed.join("\u0000")}\u0000`);
      for (const path of [...reads.keys()].sort(compareStrings)) {
        hash.update(`read\u0000${path}\u0000${reads.get(path) ?? ""}\u0000`);
      }
      return `sha256:${hash.digest("hex")}`;
    },
  };
}
