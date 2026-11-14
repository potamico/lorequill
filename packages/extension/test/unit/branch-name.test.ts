import { describe, expect, it } from "vitest";
import { branchNameFrom, isValidBranchName } from "../../src/core/git/branch-name";

describe("branch names", () => {
  it("suggests a name from a commit subject", () => {
    expect(branchNameFrom("docs: Wertstrom ergänzt")).toBe("wertstrom-ergaenzt");
    expect(branchNameFrom("feat(glossar)!: Größe & Maße")).toBe("groesse-masse");
    expect(branchNameFrom("Café für Zürich")).toBe("cafe-fuer-zuerich");
    expect(branchNameFrom("Update index.md")).toBe("update-index-md");
    expect(branchNameFrom("🎉 …")).toBeUndefined();
  });

  it("keeps suggestions short at word boundaries", () => {
    const name = branchNameFrom("a very long subject ".repeat(10));
    expect(name?.length).toBeLessThanOrEqual(50);
    expect(name).toMatch(/^[a-z0-9-]+[a-z0-9]$/);
    expect(branchNameFrom("x".repeat(80))).toHaveLength(50);
  });

  it("accepts names Git accepts and rejects the others", () => {
    for (const name of ["update-glossary", "feature/docs", "changes-2026-11-13", "Fix_1"]) {
      expect(isValidBranchName(name)).toBe(true);
    }
    for (const name of [
      "",
      "with spaces",
      "-option",
      "a..b",
      "ends/",
      "ends.",
      "x.lock",
      ".hidden",
      "a//b",
      "a~1",
      "a:b",
      "@",
      "a@{b",
    ]) {
      expect(isValidBranchName(name)).toBe(false);
    }
  });
});
