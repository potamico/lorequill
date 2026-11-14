import { chmod, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Profile } from "@lorequill/profile";
import { afterEach, describe, expect, it } from "vitest";
import { checkTree, commitChecked, joinPrefix, type CheckTarget } from "../../src/core/git/commit";
import { defaultCommitMessage, dialogEntries, planSelection } from "../../src/core/git/commit-plan";
import { GitBinary } from "../../src/core/git/git-process";
import { readHead } from "../../src/core/git/repository";
import { blocksSubmit, parseReviewState } from "../../src/core/git/review-state";
import { createRepository, type DisposableRepository } from "./git-fixture";

const posixOnly = it.skipIf(process.platform === "win32");

const PROFILE_YAML = `version: 1
content:
  root: docs
  include: ["**/*.md"]
checks:
  rules:
    - { id: links, rule: relative-links }
`;

const workingProfile: Profile = {
  version: 1,
  content: { root: "docs", include: ["**/*.md"] },
  checks: { rules: [{ id: "links", rule: "relative-links" }] },
};

const target: CheckTarget = { folderPrefix: "", contentPrefix: "docs", workingProfile };

let repositories: DisposableRepository[] = [];

async function repository(files: Record<string, string> = {}): Promise<DisposableRepository> {
  const repo = await createRepository();
  repositories.push(repo);
  await repo.commit({ ".lorequill/config.yaml": PROFILE_YAML, "docs/a.md": "# A\n", ...files });
  return repo;
}

async function hook(repo: DisposableRepository, name: string, script: string): Promise<void> {
  const file = join(repo.root, ".git", "hooks", name);
  await writeFile(file, `#!/bin/sh\n${script}\n`);
  await chmod(file, 0o755);
}

afterEach(async () => {
  for (const repo of repositories) {
    await repo.dispose();
  }
  repositories = [];
});

describe("checkTree", () => {
  it("does not block a page that lacks a required collection field without a rule (AT 44)", async () => {
    const profileYaml = `${PROFILE_YAML}collections:
  - id: note
    folder: notes
    match: { field: kind, equals: note }
    fields:
      - { key: owner, label: Owner, widget: string, required: true }
`;
    const repo = await repository({ ".lorequill/config.yaml": profileYaml });
    await repo.write("docs/notes/n.md", "---\nkind: note\n---\n# Note without owner\n");
    repo.git(["add", "docs/notes/n.md"]);

    const check = await checkTree(new GitBinary("git", repo.root), { kind: "index" }, target);
    expect(check.kind === "checked" && check.result.status).toBe("passed");
  });

  it("checks the staged tree, not the working tree", async () => {
    const repo = await repository();
    await repo.write("docs/a.md", "# A\n\n[Missing](missing.md)\n");
    repo.git(["add", "docs/a.md"]);
    await repo.write("docs/a.md", "# A, fixed but not staged\n");

    const check = await checkTree(new GitBinary("git", repo.root), { kind: "index" }, target);
    expect(check.kind).toBe("checked");
    if (check.kind === "checked") {
      expect(check.result.status).toBe("failed");
      expect(check.result.findings.map(({ path, code }) => `${path} ${code}`)).toEqual([
        "docs/a.md relative-links/missing-target",
      ]);
      expect(check.profileSource).toBe("tree");
    }
  });

  it("validates a staged page deletion through broken links", async () => {
    const repo = await repository({ "docs/b.md": "# B\n\n[A](a.md)\n" });
    repo.git(["rm", "-q", "docs/a.md"]);
    const check = await checkTree(new GitBinary("git", repo.root), { kind: "index" }, target);
    expect(check.kind === "checked" && check.result.findings.map(({ path }) => path)).toEqual([
      "docs/b.md",
    ]);
  });

  it("uses the staged profile, as CI would", async () => {
    const repo = await repository({ "docs/b.md": "[x](nowhere.md)\n" });
    await repo.write(".lorequill/config.yaml", PROFILE_YAML.replace(/checks:[\s\S]*/, ""));
    repo.git(["add", ".lorequill/config.yaml"]);
    const check = await checkTree(new GitBinary("git", repo.root), { kind: "index" }, target);
    expect(check.kind === "checked" && check.result.status).toBe("passed");
  });

  it("falls back to the working-tree profile when the profile is not tracked", async () => {
    const repo = await createRepository();
    repositories.push(repo);
    await repo.commit({ "docs/a.md": "[x](nowhere.md)\n" });
    const check = await checkTree(new GitBinary("git", repo.root), { kind: "index" }, target);
    expect(check.kind === "checked" && check.profileSource).toBe("working-tree");
    expect(check.kind === "checked" && check.result.status).toBe("failed");
  });

  it("refuses an invalid staged profile and a conflicted index", async () => {
    const repo = await repository();
    await repo.write(".lorequill/config.yaml", "version: 1\nbogus: true\n");
    repo.git(["add", ".lorequill/config.yaml"]);
    const git = new GitBinary("git", repo.root);
    expect((await checkTree(git, { kind: "index" }, target)).kind).toBe("invalid-profile");

    repo.git(["reset", "-q", "--hard"]);
    repo.git(["checkout", "-q", "-b", "other"]);
    await repo.commit({ "docs/a.md": "# Other\n" });
    repo.git(["checkout", "-q", "main"]);
    await repo.commit({ "docs/a.md": "# Main\n" });
    try {
      repo.git(["merge", "-q", "other"]);
    } catch {
      // Stops with a conflict, as intended.
    }
    expect(await checkTree(git, { kind: "index" }, target)).toEqual({
      kind: "conflicted",
      paths: ["docs/a.md"],
    });
  });

  it("checks a commit's tree for verification", async () => {
    const repo = await repository();
    const commit = await repo.commit({ "docs/b.md": "[x](gone.md)\n" });
    await repo.write("docs/b.md", "# Fixed in the working tree only\n");
    const check = await checkTree(
      new GitBinary("git", repo.root),
      { kind: "commit", commit },
      target,
    );
    expect(check.kind === "checked" && check.result.status).toBe("failed");
  });
});

describe("commitChecked", () => {
  async function checked(repo: DisposableRepository) {
    const check = await checkTree(new GitBinary("git", repo.root), { kind: "index" }, target);
    if (check.kind !== "checked") {
      throw new Error(check.kind);
    }
    return check;
  }

  it("commits two staged pages together on the current branch with the approved message", async () => {
    const repo = await repository();
    repo.git(["checkout", "-q", "-b", "feature/pages"]);
    await repo.write("docs/a.md", "# A, edited\n");
    await repo.write("docs/b.md", "# B, new\n");
    await repo.write("docs/unstaged.md", "# Not part of the commit\n");
    repo.git(["add", "docs/a.md", "docs/b.md"]);
    const check = await checked(repo);

    const git = new GitBinary("git", repo.root);
    const outcome = await commitChecked(git, "docs: two pages\n\nBody line.", check);
    expect(outcome).toMatchObject({ kind: "committed", verified: true, tree: check.tree });
    expect(repo.git(["log", "-1", "--format=%B"])).toBe("docs: two pages\n\nBody line.");
    expect(repo.git(["log", "-1", "--format=%an <%ae>"])).toBe(
      "Lorequill Test <test@example.invalid>",
    );
    expect(repo.git(["show", "--name-only", "--format=", "HEAD"]).split("\n")).toEqual([
      "docs/a.md",
      "docs/b.md",
    ]);
    expect(repo.git(["status", "--porcelain"])).toBe("?? docs/unstaged.md");
    const head = await readHead(git);
    expect(head.kind === "branch" && head.branch).toBe("feature/pages");

    // A second commit stays on the same branch.
    await repo.write("docs/b.md", "# B, again\n");
    repo.git(["add", "docs/b.md"]);
    const second = await commitChecked(git, "docs: again", await checked(repo));
    expect(second.kind).toBe("committed");
    expect(repo.git(["rev-parse", "--abbrev-ref", "HEAD"])).toBe("feature/pages");
    expect(repo.git(["rev-list", "--count", "HEAD"])).toBe("3");
  });

  it("refuses to commit when the index changed after the check", async () => {
    const repo = await repository();
    await repo.write("docs/a.md", "# Checked\n");
    repo.git(["add", "docs/a.md"]);
    const check = await checked(repo);
    await repo.write("docs/a.md", "# Changed after the check\n");
    repo.git(["add", "docs/a.md"]);

    expect(await commitChecked(new GitBinary("git", repo.root), "m", check)).toEqual({
      kind: "changed",
    });
    expect(repo.git(["rev-list", "--count", "HEAD"])).toBe("1");
  });

  it("refuses to commit when HEAD changed after the check", async () => {
    const repo = await repository();
    await repo.write("docs/a.md", "# Checked\n");
    repo.git(["add", "docs/a.md"]);
    const check = await checked(repo);
    repo.git(["stash", "-q"]);
    await repo.commit({ "docs/other.md": "# Other\n" });
    repo.git(["stash", "pop", "-q"]);
    repo.git(["add", "docs/a.md"]);

    expect((await commitChecked(new GitBinary("git", repo.root), "m", check)).kind).toBe("changed");
  });

  posixOnly("marks the commit unverified when a hook changes the staged tree", async () => {
    const repo = await repository();
    await hook(
      repo,
      "pre-commit",
      'echo "# Added by a hook" > docs/hook.md && git add docs/hook.md',
    );
    await repo.write("docs/a.md", "# Edited\n");
    repo.git(["add", "docs/a.md"]);
    const check = await checked(repo);

    const outcome = await commitChecked(new GitBinary("git", repo.root), "m", check);
    expect(outcome).toMatchObject({ kind: "committed", verified: false });
    expect(outcome.kind === "committed" && outcome.tree).not.toBe(check.tree);
  });

  posixOnly("reports a failing hook and keeps the staged changes", async () => {
    const repo = await repository();
    await hook(repo, "pre-commit", 'echo "rejected by hook" >&2; exit 1');
    await repo.write("docs/a.md", "# Edited\n");
    repo.git(["add", "docs/a.md"]);
    const check = await checked(repo);

    const outcome = await commitChecked(new GitBinary("git", repo.root), "m", check);
    expect(outcome).toMatchObject({ kind: "failed", exitCode: 1 });
    expect(outcome.kind === "failed" && outcome.stderr).toContain("rejected by hook");
    expect(repo.git(["status", "--porcelain"])).toBe("M  docs/a.md");
  });

  it("creates the first commit on an unborn branch", async () => {
    const repo = await createRepository();
    repositories.push(repo);
    await repo.write("docs/a.md", "# A\n");
    repo.git(["add", "docs/a.md"]);
    const check = await checked(repo);
    const outcome = await commitChecked(new GitBinary("git", repo.root), "first", check);
    expect(outcome).toMatchObject({ kind: "committed", verified: true });
  });
});

describe("commit dialog plan", () => {
  const files = [
    { path: "docs/staged.md", staged: true, unstaged: false, untracked: false },
    { path: "docs/partial.md", staged: true, unstaged: true, untracked: false },
    { path: "docs/changed.md", staged: false, unstaged: true, untracked: false },
    { path: "docs/new.md", staged: false, unstaged: true, untracked: true },
    { path: "package.json", staged: true, unstaged: false, untracked: false },
  ];

  it("selects and marks staged files, marks partial staging and files outside the content root", () => {
    const entries = dialogEntries(files, "docs");
    expect(entries.map(({ file }) => file.path)).toEqual([
      "docs/changed.md",
      "docs/new.md",
      "docs/partial.md",
      "docs/staged.md",
      "package.json",
    ]);
    const byPath = new Map(entries.map((entry) => [entry.file.path, entry]));
    expect(byPath.get("docs/partial.md")).toMatchObject({ picked: true, partiallyStaged: true });
    expect(byPath.get("docs/changed.md")).toMatchObject({ picked: false, preStaged: false });
    expect(byPath.get("package.json")).toMatchObject({ preStaged: true, outsideContentRoot: true });
  });

  it("stages and unstages whole files and asks to confirm pre-staged unrelated files", () => {
    const entries = dialogEntries(files, "docs");
    const plan = planSelection(
      entries,
      new Set(["docs/partial.md", "docs/new.md", "package.json"]),
    );
    expect(plan).toEqual({
      stage: ["docs/new.md"],
      unstage: ["docs/staged.md"],
      confirm: ["package.json"],
      empty: false,
    });
    expect(planSelection(entries, new Set()).empty).toBe(true);
    expect(planSelection(entries, new Set()).unstage).toEqual([
      "docs/partial.md",
      "docs/staged.md",
      "package.json",
    ]);
  });

  it("writes the default message in the content locale", () => {
    expect(defaultCommitMessage("en")).toBe("docs: update content");
    expect(defaultCommitMessage("de-CH")).toBe("docs: Inhalt aktualisieren");
  });

  it("joins a folder prefix and a profile content root", () => {
    expect(joinPrefix("", "docs")).toBe("docs");
    expect(joinPrefix("", ".")).toBe("");
    expect(joinPrefix("site", "docs/")).toBe("site/docs");
    expect(joinPrefix("site", ".")).toBe("site");
  });
});

describe("review state", () => {
  const commit = "a".repeat(40);

  it("blocks Submit while a commit is unverified or failed its verification", () => {
    expect(blocksSubmit(undefined)).toBe(false);
    expect(blocksSubmit({ kind: "verified", commit })).toBe(false);
    expect(blocksSubmit({ kind: "unverified", commit })).toBe(true);
    expect(blocksSubmit({ kind: "verification-failed", commit, findings: 2 })).toBe(true);
  });

  it("parses persisted states and rejects anything else", () => {
    expect(parseReviewState({ kind: "unverified", commit })).toEqual({
      kind: "unverified",
      commit,
    });
    expect(parseReviewState({ kind: "verification-failed", commit, findings: 1 })).toEqual({
      kind: "verification-failed",
      commit,
      findings: 1,
    });
    expect(parseReviewState({ kind: "unverified", commit: "HEAD" })).toBeUndefined();
    expect(parseReviewState({ kind: "other", commit })).toBeUndefined();
    expect(parseReviewState(null)).toBeUndefined();
  });
});
