import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { createRunCache, ENGINE_VERSION, runChecks, withOverrides } from "../../src";
import { memorySnapshot, profileWith } from "./helpers";

const files = {
  "b.md": "---\nid: X-1\n---\n[x](gone.md) TODO\n",
  "a.md": "---\nid: x-1\n---\nTODO [y](also-gone.md)\n",
  "c/d.md": "# D\n",
};
const profile = profileWith([
  { id: "links", rule: "relative-links" },
  { id: "todo", rule: "forbidden-text", text: "TODO" },
  { id: "ids", rule: "unique-field", field: "id" },
]);

describe("runChecks", () => {
  it("returns identical findings and snapshot ids regardless of listing order", async () => {
    const first = await runChecks({ profile, snapshot: memorySnapshot(files) });
    const second = await runChecks({
      profile,
      snapshot: memorySnapshot(files, { order: "reversed" }),
    });
    expect(second.findings).toEqual(first.findings);
    expect(second.snapshotId).toBe(first.snapshotId);
    expect(first.snapshotId).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(first.engineVersion).toBe(ENGINE_VERSION);
  });

  it("orders findings by path, line, column, and check id", async () => {
    const result = await runChecks({ profile, snapshot: memorySnapshot(files) });
    expect(
      result.findings.map(({ path, line, ruleId }) => `${path}:${String(line)}:${ruleId}`),
    ).toEqual([
      "docs/a.md:4:todo",
      "docs/a.md:4:links",
      "docs/b.md:2:ids",
      "docs/b.md:4:links",
      "docs/b.md:4:todo",
    ]);
  });

  it("changes the snapshot id when a checked text changes", async () => {
    const before = await runChecks({ profile, snapshot: memorySnapshot(files) });
    const after = await runChecks({
      profile,
      snapshot: memorySnapshot({ ...files, "c/d.md": "# Changed\n" }),
    });
    expect(after.snapshotId).not.toBe(before.snapshotId);
  });

  it("checks unsaved buffers through overrides", async () => {
    const base = memorySnapshot({ "a.md": "[x](b.md)\n" });
    const saved = await runChecks({ profile, snapshot: base });
    expect(saved.status).toBe("failed");
    const unsaved = await runChecks({
      profile,
      snapshot: withOverrides(base, new Map([["b.md", "# B\n"]])),
    });
    expect(unsaved.status).toBe("passed");
  });

  it("passes with no rules and with no pages", async () => {
    expect(
      (await runChecks({ profile: profileWith([]), snapshot: memorySnapshot(files) })).status,
    ).toBe("passed");
    expect((await runChecks({ profile, snapshot: memorySnapshot({}) })).status).toBe("passed");
  });

  it("reports cancellation as an error, never as a pass", async () => {
    const controller = new AbortController();
    controller.abort();
    const result = await runChecks({
      profile,
      snapshot: memorySnapshot(files),
      signal: controller.signal,
    });
    expect(result.status).toBe("error");
    expect(result.error).toEqual({ code: "cancelled" });
  });

  it("reports a timeout as an error", async () => {
    const slow = profileWith([{ id: "links", rule: "relative-links" }], {
      checks: { timeout_seconds: 1, rules: [{ id: "links", rule: "relative-links" }] },
    });
    const many = Object.fromEntries(
      Array.from({ length: 30 }, (_, index) => [`p${String(index)}.md`, "[x](gone.md)\n"]),
    );
    const result = await runChecks({
      profile: slow,
      snapshot: memorySnapshot(many, { delayMs: 60 }),
    });
    expect(result.status).toBe("error");
    expect(result.error?.code).toBe("timeout");
  });

  it("stops at resource limits with an incomplete status", async () => {
    const tooLarge = await runChecks({
      profile,
      snapshot: memorySnapshot(files),
      limits: { maxPageLength: 10 },
    });
    expect(tooLarge).toMatchObject({
      status: "error",
      error: { code: "page-too-large", path: "docs/a.md" },
    });

    const tooMany = await runChecks({
      profile,
      snapshot: memorySnapshot(files),
      limits: { maxFindings: 2 },
    });
    expect(tooMany.status).toBe("error");
    expect(tooMany.error?.code).toBe("too-many-findings");
    expect(tooMany.findings).toHaveLength(2);
  });

  it("reports a truncated listing as incomplete", async () => {
    const base = memorySnapshot(files);
    const truncated = {
      ...base,
      listFiles: async () => ({ ...(await base.listFiles()), truncated: true }),
    };
    const result = await runChecks({ profile, snapshot: truncated });
    expect(result.error?.code).toBe("too-many-files");
  });

  it("supports the repository root as content root", async () => {
    const atRoot = profileWith([{ id: "links", rule: "relative-links" }], {
      content: { root: ".", include: ["**/*.md"] },
    });
    const result = await runChecks({
      profile: atRoot,
      snapshot: memorySnapshot({ "a.md": "[x](b.md)\n" }),
    });
    expect(result.findings[0]?.path).toBe("a.md");
  });
});

describe("ENGINE_VERSION", () => {
  it("matches the package version", () => {
    const manifest = JSON.parse(
      readFileSync(resolve(import.meta.dirname, "../../package.json"), "utf8"),
    ) as { version: string };
    expect(ENGINE_VERSION).toBe(manifest.version);
  });
});

describe("run cache", () => {
  it("reuses parsed pages with identical text and drops removed pages", async () => {
    const cache = createRunCache();
    await runChecks({ profile, snapshot: memorySnapshot(files), cache });
    const before = cache.pages.get("c/d.md");
    expect(before).toBeDefined();
    const documentBefore = before?.document();

    const changed = { "a.md": files["a.md"], "c/d.md": "# Changed\n" } as Record<string, string>;
    const result = await runChecks({ profile, snapshot: memorySnapshot(changed), cache });
    expect(cache.pages.has("b.md")).toBe(false);
    expect(cache.pages.get("c/d.md")).not.toBe(before);
    expect(cache.pages.get("c/d.md")?.document()).not.toBe(documentBefore);

    const unchanged = cache.pages.get("a.md");
    await runChecks({ profile, snapshot: memorySnapshot(changed), cache });
    expect(cache.pages.get("a.md")).toBe(unchanged);
    expect(result.findings).toEqual(
      (await runChecks({ profile, snapshot: memorySnapshot(changed) })).findings,
    );
  });
});
