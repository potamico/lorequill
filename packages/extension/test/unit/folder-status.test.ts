import { parseProfile, type ProfileResult } from "@lorequill/profile";
import { describe, expect, it } from "vitest";
import {
  classifyProfileResult,
  describeIssue,
  describeStatus,
  type FolderStatus,
} from "../../src/core/folder-status";
import { createTranslator } from "../../src/core/i18n";

const MINIMAL = "version: 1\ncontent:\n  root: docs\n  include: ['**/*.md']\n";
const translate = createTranslator("en");

function statusOf(yaml: string): FolderStatus {
  return classifyProfileResult(parseProfile(yaml));
}

function notReady(status: FolderStatus): Exclude<FolderStatus, { kind: "ready" }> {
  if (status.kind === "ready") {
    throw new Error("Expected a status that is not ready.");
  }
  return status;
}

describe("classifyProfileResult", () => {
  it("accepts a valid profile", () => {
    const status = statusOf(MINIMAL);
    expect(status.kind).toBe("ready");
  });

  it("recognizes a missing profile file", () => {
    const result: ProfileResult = { ok: false, issues: [{ code: "profile-not-found", path: "" }] };
    expect(classifyProfileResult(result)).toEqual({ kind: "profile-missing" });
  });

  it("recognizes an unsupported version", () => {
    const status = statusOf("version: 2\ncontent: {root: docs, include: ['*.md']}\n");
    expect(status.kind).toBe("profile-unsupported");
  });

  it.each([
    ["a syntax error", "version: [1\n"],
    ["an unknown key", `${MINIMAL}extra: true\n`],
    ["an empty file", ""],
    [
      "a rule with argv",
      `${MINIMAL}checks:\n  rules:\n    - {id: x, rule: forbidden-text, argv: [a]}\n`,
    ],
  ])("recognizes %s as an invalid profile", (_name, yaml) => {
    expect(statusOf(yaml).kind).toBe("profile-invalid");
  });
});

describe("describeStatus", () => {
  it("explains a missing profile and disabled editing", () => {
    const message = describeStatus(notReady({ kind: "profile-missing" }), translate);
    expect(message.message).toContain(".lorequill/config.yaml");
    expect(message.message).toContain("Managed editing is disabled");
    expect(message.canOpenProfile).toBe(false);
  });

  it("explains an unsupported version with both version numbers", () => {
    const message = describeStatus(
      notReady(statusOf("version: 7\ncontent: {root: docs, include: ['*.md']}\n")),
      translate,
    );
    expect(message.message).toContain("version 7 is not supported");
    expect(message.message).toContain("supports version 1");
    expect(message.canOpenProfile).toBe(true);
  });

  it("explains an invalid profile with the first problem and its line", () => {
    const message = describeStatus(notReady(statusOf(`${MINIMAL}extra: true\n`)), translate);
    expect(message.message).toContain("The profile is invalid.");
    expect(message.message).toContain('The key "extra" is not allowed');
    expect(message.message).toContain("Managed editing is disabled");
    expect(message.profileLine).toBe(5);
    expect(message.details.length).toBeGreaterThan(0);
    expect(message.canOpenProfile).toBe(true);
  });

  it("gives one message for several problems and lists up to ten of them", () => {
    const keys = Array.from({ length: 15 }, (_, index) => `extra${String(index)}: 1`).join("\n");
    const message = describeStatus(notReady(statusOf(`${MINIMAL}${keys}\n`)), translate);
    expect(message.message).toContain("Problems in total: 15");
    expect(message.details).toHaveLength(10);
  });

  it("reports a YAML syntax error with its line", () => {
    const message = describeStatus(notReady(statusOf("version: 1\ncontent: [\n")), translate);
    expect(message.message).toMatch(/YAML syntax error/);
    expect(message.profileLine).toBeGreaterThanOrEqual(1);
  });

  it("does not offer to open a profile outside the workspace folder", () => {
    const message = describeStatus(
      notReady(
        classifyProfileResult({
          ok: false,
          issues: [{ code: "profile-outside-workspace", path: "" }],
        }),
      ),
      translate,
    );
    expect(message.canOpenProfile).toBe(false);
  });

  it("explains an unusable content root", () => {
    const missing = describeStatus(
      { kind: "content-root-invalid", problem: "missing", root: "docs" },
      translate,
    );
    expect(missing.message).toContain('"docs" does not exist');
    const outside = describeStatus(
      { kind: "content-root-invalid", problem: "outside", root: "docs" },
      translate,
    );
    expect(outside.message).toContain("outside this workspace folder");
    expect(outside.canOpenProfile).toBe(true);
  });

  it("explains remote folders and failed scans", () => {
    expect(describeStatus({ kind: "unsupported-location" }, translate).message).toContain(
      "local file system",
    );
    expect(describeStatus({ kind: "scan-failed" }, translate).message).toContain("Refresh");
  });

  it("translates the messages", () => {
    const german = createTranslator("de-CH");
    const message = describeStatus(notReady({ kind: "profile-missing" }), german);
    expect(message.message).toContain("kein Profil gefunden");
    const invalid = describeStatus(notReady(statusOf(`${MINIMAL}extra: true\n`)), german);
    expect(invalid.message).toContain("Das Profil ist ungültig.");
    expect(invalid.message).toContain("Zeile 5");
  });

  it("every status that is not ready has a message in every locale", () => {
    const statuses: FolderStatus[] = [
      { kind: "unsupported-location" },
      { kind: "profile-missing" },
      notReady(statusOf("version: 9\ncontent: {root: d, include: ['*.md']}\n")),
      notReady(statusOf("")),
      { kind: "content-root-invalid", problem: "missing", root: "x" },
      { kind: "scan-failed" },
    ];
    for (const locale of ["en", "de-CH"] as const) {
      for (const status of statuses) {
        const text = describeStatus(notReady(status), createTranslator(locale)).message;
        expect(text, `${locale} ${status.kind}`).not.toMatch(/\{\w+\}/);
        expect(text.length).toBeGreaterThan(10);
      }
    }
  });
});

describe("describeIssue", () => {
  it("shows the whole document as a root path and drops the line when it is unknown", () => {
    const text = describeIssue(
      { code: "invalid-type", path: "", params: { expected: "object" } },
      translate,
    );
    expect(text).toBe("The value at / must be of type object.");
  });

  it("adds the line when known", () => {
    const text = describeIssue({ code: "yaml-duplicate-key", path: "", line: 4 }, translate);
    expect(text).toBe("Line 4: The profile contains a duplicate key.");
  });

  it("has a readable message for every issue produced by the profile validator", () => {
    const samples = [
      "",
      "version: [",
      "version: 2\n",
      "version: 1\n",
      `${MINIMAL}x: 1\n`,
      `${MINIMAL}checks:\n  rules:\n    - {id: a, rule: nope}\n`,
      `${MINIMAL}checks:\n  rules:\n    - {id: a, rule: forbidden-text, text: x}\n    - {id: a, rule: forbidden-text, text: y}\n`,
      "version: 1\ncontent: 5\n",
      "version: &a 1\ncontent: {root: d, include: ['*.md']}\n",
    ];
    for (const yaml of samples) {
      const result = parseProfile(yaml);
      if (!result.ok) {
        for (const issue of result.issues) {
          expect(describeIssue(issue, translate), issue.code).not.toMatch(/\{\w+\}/);
        }
      }
    }
  });
});
