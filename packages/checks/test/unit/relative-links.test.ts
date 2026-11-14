import { describe, expect, it } from "vitest";
import { runChecks, type CheckResult } from "../../src";
import { memorySnapshot, profileWith } from "./helpers";

async function check(
  files: Record<string, string>,
  rule: { anchors?: boolean; slugify?: "ascii" | "unicode" } = {},
  exclude?: string[],
): Promise<CheckResult> {
  const profile = profileWith([{ id: "links", rule: "relative-links", ...rule }], {
    content: { root: "docs", include: ["**/*.md"], ...(exclude ? { exclude } : {}) },
  });
  return runChecks({ profile, snapshot: memorySnapshot(files) });
}

function codes(result: CheckResult): string[] {
  return result.findings.map(({ path, line, code }) => `${path}:${String(line)} ${code}`);
}

async function checkDrafts(files: Record<string, string>): Promise<CheckResult> {
  const profile = profileWith([{ id: "links", rule: "relative-links" }], {
    content: { root: "docs", include: ["**/*.md"], drafts: ["drafts/**"] },
  });
  return runChecks({ profile, snapshot: memorySnapshot(files) });
}

describe("relative-links with drafts", () => {
  it("reports links from published pages to drafts, including non-Markdown drafts", async () => {
    const result = await checkDrafts({
      "index.md": "[idea](drafts/idea.md)\n[slides](drafts/slides.pdf)\n[ok](guide.md)\n",
      "guide.md": "# Guide\n",
      "drafts/idea.md": "# Idea\n",
      "drafts/slides.pdf": "%PDF",
    });
    expect(codes(result)).toEqual([
      "docs/index.md:1 relative-links/target-is-draft",
      "docs/index.md:2 relative-links/target-is-draft",
    ]);
    expect(result.findings[0]?.message).toBe(
      'Link target "docs/drafts/idea.md" is a draft and is not published; link to it only from other drafts.',
    );
  });

  it("lets drafts link to drafts and to published pages", async () => {
    const result = await checkDrafts({
      "index.md": "# Home\n",
      "drafts/idea.md": "[other](other.md) [home](../index.md#home)\n",
      "drafts/other.md": "# Other\n",
    });
    expect(result.findings).toEqual([]);
  });

  it("still reports a missing draft as missing", async () => {
    const result = await checkDrafts({ "index.md": "[idea](drafts/gone.md)\n" });
    expect(codes(result)).toEqual(["docs/index.md:1 relative-links/missing-target"]);
  });
});

describe("relative-links", () => {
  it("passes for valid relative, parent, external, and non-Markdown targets", async () => {
    const result = await check({
      "index.md":
        "[a](guides/setup.md) [b](https://example.com) [c](mailto:a@b.ch) [d](files/x.pdf)\n",
      "guides/setup.md": "[up](../index.md) [self](#setup)\n\n# Setup\n",
      "files/x.pdf": "%PDF",
    });
    expect(result.status).toBe("passed");
    expect(result.findings).toEqual([]);
    expect(result.pagesChecked).toBe(2);
  });

  it("reports missing targets, directories, and invalid destinations with positions", async () => {
    const result = await check({
      "index.md": [
        "[missing](nope.md)",
        "[dir](guides)",
        "[abs](/docs/index.md)",
        "[scheme](file:///etc/passwd)",
        "[escape](../../outside.md)",
        "[bad](a%zz.md)",
        "[empty]()",
        "",
      ].join("\n"),
      "guides/setup.md": "# Setup\n",
    });
    expect(result.status).toBe("failed");
    expect(codes(result)).toEqual([
      "docs/index.md:1 relative-links/missing-target",
      "docs/index.md:2 relative-links/target-is-directory",
      "docs/index.md:3 relative-links/absolute-path",
      "docs/index.md:4 relative-links/unsupported-scheme",
      "docs/index.md:5 relative-links/outside-content-root",
      "docs/index.md:6 relative-links/malformed-encoding",
      "docs/index.md:7 relative-links/empty",
    ]);
    expect(result.findings[0]).toMatchObject({
      ruleId: "links",
      rule: "relative-links",
      severity: "error",
      column: 1,
      message: 'Link target "docs/nope.md" does not exist.',
    });
  });

  it("checks anchors in the same page and in target pages, including excluded ones", async () => {
    const result = await check(
      {
        "index.md":
          "# Start\n\n[ok](#start) [bad](#nope) [t](intro.md#identitat) [t2](intro.md#missing) [ex](drafts/x.md#draft)\n",
        "intro.md": "# Identität\n",
        "drafts/x.md": "# Draft\n",
      },
      {},
      ["drafts/**"],
    );
    expect(codes(result)).toEqual([
      "docs/index.md:3 relative-links/missing-anchor",
      "docs/index.md:3 relative-links/missing-anchor",
    ]);
    expect(result.findings.map(({ params }) => params.anchor)).toEqual(["nope", "missing"]);
  });

  it("uses the configured slugify and can skip anchors", async () => {
    const files = { "a.md": "[x](b.md#identität)\n", "b.md": "# Identität\n" };
    expect((await check(files)).status).toBe("failed");
    expect((await check(files, { slugify: "unicode" })).status).toBe("passed");
    expect((await check(files, { anchors: false })).status).toBe("passed");
  });

  it("does not check fragments of non-Markdown targets", async () => {
    const result = await check({ "a.md": "[x](file.pdf#page=2)\n", "file.pdf": "%PDF" });
    expect(result.status).toBe("passed");
  });

  it("checks links inside Material containers and reports definitions once", async () => {
    const result = await check({
      "a.md":
        '!!! note "Note"\n    [broken](gone.md)\n\n[r1][ref] [r2][ref]\n\n[ref]: missing.md\n',
    });
    expect(codes(result)).toEqual([
      "docs/a.md:2 relative-links/missing-target",
      "docs/a.md:6 relative-links/missing-target",
    ]);
  });

  it("only checks included pages as sources", async () => {
    const result = await check({ "drafts/x.md": "[broken](gone.md)\n" }, {}, ["drafts/**"]);
    expect(result.status).toBe("passed");
    expect(result.pagesChecked).toBe(0);
  });
});
