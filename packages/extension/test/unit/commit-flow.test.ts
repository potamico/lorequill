import type { CheckResult, Finding } from "@lorequill/checks";
import { describe, expect, it } from "vitest";
import type { CommitOutcome, TreeCheck } from "../../src/core/git/commit";
import {
  commitFlow,
  commitFlowResult,
  reviewStateAfterCommit,
  reviewStateAfterVerify,
  verifyFlow,
  type CommitFacts,
  type CommitPorts,
  type MessageRequest,
} from "../../src/core/git/commit-flow";
import type { ChangedFile } from "../../src/core/git/commit-plan";
import type { Head } from "../../src/core/git/repository";

const commit = "a".repeat(40);
const head: Head = { kind: "branch", branch: "feature/docs", commit };
const committed = "b".repeat(40);

function file(path: string, staged = false): ChangedFile {
  return { path, staged, unstaged: !staged, untracked: false };
}

function result(status: CheckResult["status"], findings = 0): CheckResult {
  return {
    status,
    findings: Array.from({ length: findings }, () => ({}) as Finding),
    ...(status === "error" ? { error: { code: "timeout" as const } } : {}),
    engineVersion: "1",
    snapshotId: "s",
    pagesChecked: 3,
  };
}

function checked(status: CheckResult["status"], findings = 0): TreeCheck {
  return {
    kind: "checked",
    head,
    tree: "t".repeat(40),
    profileSource: "tree",
    result: result(status, findings),
  };
}

function facts(overrides: Partial<CommitFacts> = {}): CommitFacts {
  return {
    head,
    conflicted: false,
    files: [file("docs/a.md"), file("docs/b.md")],
    contentPrefix: "docs",
    defaultMessage: "docs: update content",
    ...overrides,
  };
}

/** Ports over a scripted index; `log` records every operation in order. */
function ports(
  script: {
    select?: readonly string[] | undefined;
    confirm?: boolean;
    check?: TreeCheck;
    message?: string | undefined;
    commit?: CommitOutcome;
    staged?: boolean;
  } = {},
) {
  const log: string[] = [];
  const requests: MessageRequest[] = [];
  const recorded: CheckResult[] = [];
  const value: CommitPorts = {
    chooseFiles: () => {
      log.push("choose");
      return Promise.resolve(
        "select" in script ? script.select && new Set(script.select) : new Set(["docs/a.md"]),
      );
    },
    confirmUnchecked: (paths) => {
      log.push(`confirm ${paths.join(",")}`);
      return Promise.resolve(script.confirm ?? false);
    },
    stage: (paths) => {
      log.push(`stage ${paths.join(",")}`);
      return Promise.resolve();
    },
    unstage: (paths) => {
      log.push(`unstage ${paths.join(",")}`);
      return Promise.resolve();
    },
    hasStagedChanges: () => Promise.resolve(script.staged ?? true),
    check: () => {
      log.push("check");
      return Promise.resolve(script.check ?? checked("passed"));
    },
    recordCheck: (checkResult) => {
      recorded.push(checkResult);
    },
    askMessage: (request) => {
      requests.push(request);
      return Promise.resolve("message" in script ? script.message : "docs: a");
    },
    commit: (message) => {
      log.push(`commit ${message}`);
      return Promise.resolve(
        script.commit ?? {
          kind: "committed",
          commit: committed,
          tree: "t".repeat(40),
          verified: true,
        },
      );
    },
  };
  return { value, log, requests, recorded };
}

describe("commitFlow", () => {
  it("stages the selection, checks, asks for the message, and commits", async () => {
    const p = ports();
    const outcome = await commitFlow(facts(), p.value);
    expect(outcome).toEqual({
      kind: "committed",
      commit: committed,
      branch: "feature/docs",
      verified: true,
    });
    expect(p.log).toEqual(["choose", "stage docs/a.md", "check", "commit docs: a"]);
    expect(p.requests).toEqual([
      {
        branch: "feature/docs",
        profileSource: "tree",
        pagesChecked: 3,
        defaultMessage: "docs: update content",
      },
    ]);
    expect(p.recorded.map(({ status }) => status)).toEqual(["passed"]);
    expect(commitFlowResult(outcome)).toBe("committed");
    expect(reviewStateAfterCommit(outcome)).toEqual({ kind: "verified", commit: committed });
  });

  it("blocks a detached HEAD and conflicts before asking anything", async () => {
    const p = ports();
    expect(
      await commitFlow(facts({ head: { kind: "detached", commit: committed } }), p.value),
    ).toEqual({
      kind: "detached",
    });
    expect(await commitFlow(facts({ conflicted: true }), p.value)).toEqual({ kind: "conflicted" });
    expect(p.log).toEqual([]);
  });

  it("commits on an unborn branch", async () => {
    const outcome = await commitFlow(
      facts({ head: { kind: "unborn", branch: "main" } }),
      ports().value,
    );
    expect(outcome).toMatchObject({ kind: "committed", branch: "main" });
  });

  it("reports no changes, an empty selection, and a cancelled dialog without touching the index", async () => {
    const p = ports();
    expect(await commitFlow(facts({ files: [] }), p.value)).toEqual({
      kind: "nothing-to-commit",
      reason: "no-changes",
    });
    expect(await commitFlow(facts(), ports({ select: [] }).value)).toEqual({
      kind: "nothing-to-commit",
      reason: "empty-selection",
    });
    const cancelled = ports({ select: undefined });
    expect(await commitFlow(facts(), cancelled.value)).toEqual({ kind: "cancelled" });
    expect(cancelled.log).toEqual(["choose"]);
  });

  it("unstages deselected files and reports when nothing stays staged", async () => {
    const p = ports({ select: ["docs/b.md"], staged: false });
    const outcome = await commitFlow(
      facts({ files: [file("docs/a.md", true), file("docs/b.md", true)] }),
      p.value,
    );
    expect(outcome).toEqual({ kind: "nothing-to-commit", reason: "empty-selection" });
    expect(p.log).toEqual(["choose", "unstage docs/a.md"]);
  });

  it("asks before including pre-staged files outside the content root", async () => {
    const files = [file("docs/a.md"), file("README.md", true)];
    const declined = ports({ select: ["docs/a.md", "README.md"] });
    expect(await commitFlow(facts({ files }), declined.value)).toEqual({ kind: "cancelled" });
    expect(declined.log).toEqual(["choose", "confirm README.md"]);

    const accepted = ports({ select: ["docs/a.md", "README.md"], confirm: true });
    expect(await commitFlow(facts({ files }), accepted.value)).toMatchObject({ kind: "committed" });
  });

  it("blocks on findings or an incomplete check and records the result", async () => {
    for (const status of ["failed", "error"] as const) {
      const p = ports({ check: checked(status, 2) });
      const outcome = await commitFlow(facts(), p.value);
      expect(outcome).toMatchObject({ kind: "check-blocked", result: { status } });
      expect(commitFlowResult(outcome)).toBe(
        status === "failed" ? "check-failed" : "check-incomplete",
      );
      expect(p.recorded.map((r) => r.status)).toEqual([status]);
      expect(p.requests).toEqual([]);
    }
  });

  it("reports a tree that cannot be checked", async () => {
    const p = ports({ check: { kind: "invalid-profile", head, tree: "t".repeat(40) } });
    const outcome = await commitFlow(facts(), p.value);
    expect(commitFlowResult(outcome)).toBe("invalid-profile");
    expect(p.recorded).toEqual([]);
  });

  it("cancels on an empty message after the check passed", async () => {
    const p = ports({ message: "  " });
    expect(await commitFlow(facts(), p.value)).toEqual({ kind: "cancelled" });
    expect(p.recorded.map((r) => r.status)).toEqual(["passed"]);
    expect(p.log.filter((entry) => entry.startsWith("commit"))).toEqual([]);
  });

  it("passes on changed, failed, and unverified commits", async () => {
    expect(await commitFlow(facts(), ports({ commit: { kind: "changed" } }).value)).toEqual({
      kind: "changed",
    });
    expect(
      await commitFlow(
        facts(),
        ports({ commit: { kind: "failed", exitCode: 1, stderr: "hook" } }).value,
      ),
    ).toEqual({ kind: "failed", exitCode: 1, stderr: "hook" });
    const unverified = await commitFlow(
      facts(),
      ports({
        commit: { kind: "committed", commit: committed, tree: "u".repeat(40), verified: false },
      }).value,
    );
    expect(commitFlowResult(unverified)).toBe("unverified");
    expect(reviewStateAfterCommit(unverified)).toEqual({ kind: "unverified", commit: committed });
  });
});

describe("verifyFlow", () => {
  it("verifies the current commit or records how it failed", async () => {
    const passed = await verifyFlow(head, () => Promise.resolve(checked("passed")));
    expect(passed).toEqual({ kind: "verified", commit });
    expect(reviewStateAfterVerify(passed)).toEqual({ kind: "verified", commit });

    const failed = await verifyFlow(head, () => Promise.resolve(checked("failed", 2)));
    expect(reviewStateAfterVerify(failed)).toEqual({
      kind: "verification-failed",
      commit,
      findings: 2,
    });

    const conflicted = await verifyFlow(head, () =>
      Promise.resolve({ kind: "conflicted", paths: ["docs/a.md"] }),
    );
    expect(reviewStateAfterVerify(conflicted)).toEqual({
      kind: "verification-failed",
      commit,
      findings: 0,
    });
  });

  it("does nothing on an unborn branch", async () => {
    const outcome = await verifyFlow({ kind: "unborn", branch: "main" }, () => {
      throw new Error("not checked");
    });
    expect(outcome).toEqual({ kind: "no-commit" });
    expect(reviewStateAfterVerify(outcome)).toBeUndefined();
  });
});
