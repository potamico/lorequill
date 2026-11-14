import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseProfile, type Profile, type ProfileIssue, type ProfileResult } from "../../src/index";

export const repositoryRoot = resolve(import.meta.dirname, "../../../..");

export function fixture(relativePath: string): string {
  return readFileSync(resolve(repositoryRoot, "fixtures/profiles", relativePath), "utf8");
}

/** A valid profile prefix; tests append the section under test. */
export const BASE = ["version: 1", "content:", "  root: docs", '  include: ["**/*.md"]', ""].join(
  "\n",
);

export function lines(...parts: string[]): string {
  return `${parts.join("\n")}\n`;
}

export function expectOk(result: ProfileResult): Profile {
  if (!result.ok) {
    throw new Error(`Expected a valid profile, got issues: ${formatIssues(result.issues)}`);
  }
  return result.profile;
}

export function issuesOf(yaml: string): readonly ProfileIssue[] {
  const result = parseProfile(yaml);
  if (result.ok) {
    throw new Error("Expected issues, but the profile is valid.");
  }
  return result.issues;
}

/** Compact `code path` representation for readable assertions. */
export function summarize(issues: readonly ProfileIssue[]): string[] {
  return issues.map((issue) => `${issue.code} ${issue.path}`.trim());
}

export function formatIssues(issues: readonly ProfileIssue[]): string {
  return summarize(issues).join(", ");
}
