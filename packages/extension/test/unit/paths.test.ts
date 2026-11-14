import { posix, win32 } from "node:path";
import { describe, expect, it } from "vitest";
import { relativeInside } from "../../src/core/paths";

describe("relativeInside", () => {
  it("gives the POSIX path inside the root, and an empty path for the root", () => {
    expect(relativeInside("/repo/docs", "/repo/docs/a/b.md", posix)).toBe("a/b.md");
    expect(relativeInside("/repo/docs/", "/repo/docs", posix)).toBe("");
  });

  it("rejects paths outside the root, including a sibling with the same prefix", () => {
    expect(relativeInside("/repo/docs", "/repo/README.md", posix)).toBeUndefined();
    expect(relativeInside("/repo/docs", "/repo/docs-old/a.md", posix)).toBeUndefined();
    expect(relativeInside("/repo/docs", "/repo/docs/../x.md", posix)).toBeUndefined();
  });

  it("keeps names that start with two dots", () => {
    expect(relativeInside("/repo/docs", "/repo/docs/..notes.md", posix)).toBe("..notes.md");
  });

  it("follows Windows rules: drive letter and name case do not matter", () => {
    expect(relativeInside("D:\\a\\site\\docs", "d:\\a\\site\\docs\\iam\\x.md", win32)).toBe(
      "iam/x.md",
    );
    expect(relativeInside("c:\\Repo\\Docs", "C:\\repo\\docs\\a.md", win32)).toBe("a.md");
    expect(relativeInside("C:\\repo\\docs", "D:\\repo\\docs\\a.md", win32)).toBeUndefined();
    expect(relativeInside("C:\\repo\\docs", "C:\\repo\\a.md", win32)).toBeUndefined();
  });
});
