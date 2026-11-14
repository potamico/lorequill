import { join, resolve } from "node:path";
import { loadProfile, type Profile, type ProfileIssue } from "@lorequill/profile";
import { runChecks, type CheckResult } from "./engine";
import { createFileSystemSnapshot } from "./snapshot";

/** The outcome of checking a repository checkout, as the CLI and the Action run it. */
export type RepositoryCheck =
  | { readonly kind: "invalid-profile"; readonly issues: readonly ProfileIssue[] }
  | { readonly kind: "no-content-root"; readonly root: string }
  | { readonly kind: "checked"; readonly profile: Profile; readonly result: CheckResult };

/**
 * Checks the files of a repository checkout with its own `.lorequill/config.yaml` (specification
 * §11, §14). It only reads files: nothing from the repository is executed, and no Git command
 * runs, so a pull request checkout is safe to check.
 */
export async function checkRepository(repository: string): Promise<RepositoryCheck> {
  const root = resolve(repository);
  const loaded = await loadProfile(root);
  if (!loaded.ok) {
    return { kind: "invalid-profile", issues: loaded.issues };
  }
  const profile = loaded.profile;
  const snapshot = createFileSystemSnapshot(join(root, ...profile.content.root.split("/")));
  if ((await snapshot.describe(".")) !== "directory") {
    return { kind: "no-content-root", root: profile.content.root };
  }
  return { kind: "checked", profile, result: await runChecks({ profile, snapshot }) };
}

/** Profile problems as indented lines, for error output. */
export function formatProfileIssues(issues: readonly ProfileIssue[]): string {
  return issues
    .map((issue) => {
      const params = issue.params ? ` ${JSON.stringify(issue.params)}` : "";
      return `  ${issue.code}${issue.path ? ` at ${issue.path}` : ""}${params}\n`;
    })
    .join("");
}
