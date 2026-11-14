import { describe, expect, it } from "vitest";
import type { Head } from "../../src/core/git/repository";
import { headChanged, repositoryProblems } from "../../src/core/git/status";

const onBranch = (branch: string, commit = "a".repeat(40)): Head => ({
  kind: "branch",
  branch,
  commit,
});

describe("repositoryProblems", () => {
  it("reports nothing for a feature branch with a remote", () => {
    expect(
      repositoryProblems({
        head: onBranch("feature/x"),
        remotes: ["origin"],
        conflicted: 0,
        baseBranch: "main",
      }),
    ).toEqual([]);
  });

  it("reports the base branch, a missing remote, and conflicts in a fixed order", () => {
    expect(
      repositoryProblems({
        head: onBranch("main"),
        remotes: [],
        conflicted: 2,
        baseBranch: "main",
      }),
    ).toEqual(["on-base-branch", "no-remote", "conflicts"]);
  });

  it("reports a detached HEAD and an unborn branch", () => {
    expect(
      repositoryProblems({
        head: { kind: "detached", commit: "b".repeat(40) },
        remotes: ["origin"],
        conflicted: 0,
        baseBranch: "main",
      }),
    ).toEqual(["detached-head"]);
    expect(
      repositoryProblems({
        head: { kind: "unborn", branch: "main" },
        remotes: ["origin"],
        conflicted: 0,
        baseBranch: "main",
      }),
    ).toEqual(["unborn-branch", "on-base-branch"]);
  });

  it("does not report the base branch when the profile names none", () => {
    expect(repositoryProblems({ head: onBranch("main"), remotes: ["o"], conflicted: 0 })).toEqual(
      [],
    );
  });
});

describe("headChanged", () => {
  it("detects another branch, another commit, and a change of kind", () => {
    expect(headChanged(onBranch("main"), onBranch("main"))).toBe(false);
    expect(headChanged(onBranch("main"), onBranch("other"))).toBe(true);
    expect(headChanged(onBranch("main"), onBranch("main", "c".repeat(40)))).toBe(true);
    expect(headChanged({ kind: "unborn", branch: "main" }, onBranch("main"))).toBe(true);
    expect(
      headChanged({ kind: "detached", commit: "a".repeat(40) }, onBranch("x", "a".repeat(40))),
    ).toBe(true);
  });
});
