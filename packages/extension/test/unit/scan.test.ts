import { mkdir, mkdtemp, rm, symlink, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { createContentScope } from "@lorequill/profile";
import { afterEach, describe, expect, it } from "vitest";
import {
  MAX_PAGE_PREFIX_BYTES,
  resolveContentRoot,
  scanPages,
  type PageCache,
  type ScanOptions,
} from "../../src/core/pages/scan";

const created: string[] = [];

async function makeWorkspace(files: Record<string, string | Buffer>): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "lorequill-scan-"));
  created.push(root);
  for (const [relative, content] of Object.entries(files)) {
    const target = path.join(root, ...relative.split("/"));
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, content);
  }
  return root;
}

afterEach(async () => {
  for (const directory of created.splice(0)) {
    await rm(directory, { recursive: true, force: true });
  }
});

function options(
  workspaceRoot: string,
  overrides: Partial<ScanOptions> & { include?: string[]; exclude?: string[] } = {},
): ScanOptions {
  const { include = ["**/*.md"], exclude = [], ...rest } = overrides;
  const [first = "**/*.md", ...others] = include;
  return {
    workspaceRoot,
    contentRoot: "docs",
    scope: createContentScope({ include: [first, ...others], exclude }),
    ...rest,
  };
}

async function pathsOf(settings: ScanOptions): Promise<string[]> {
  const result = await scanPages(settings);
  if (!result.ok) {
    throw new Error(`Scan failed: ${result.reason}`);
  }
  return result.pages.map((page) => page.path);
}

describe("scanPages: which pages are listed", () => {
  it("lists included Markdown files at any depth, sorted by path", async () => {
    const root = await makeWorkspace({
      "docs/b.md": "# B\n",
      "docs/a.md": "# A\n",
      "docs/guides/setup.md": "# Setup\n",
      "docs/guides/deep/more.md": "# More\n",
      "docs/image.png": "x",
      "docs/notes.txt": "x",
      "outside.md": "# Outside\n",
    });
    expect(await pathsOf(options(root))).toEqual([
      "a.md",
      "b.md",
      "guides/deep/more.md",
      "guides/setup.md",
    ]);
  });

  it("applies include and exclude patterns", async () => {
    const root = await makeWorkspace({
      "docs/index.md": "# Home\n",
      "docs/guides/index.md": "# Guides\n",
      "docs/guides/setup.md": "# Setup\n",
      "docs/drafts/idea.md": "# Idea\n",
    });
    expect(await pathsOf(options(root, { exclude: ["**/index.md", "drafts/**"] }))).toEqual([
      "guides/setup.md",
    ]);
  });

  it("matches the extension .md in any case but requires a regular file", async () => {
    const root = await makeWorkspace({
      "docs/upper.MD": "# Upper\n",
      "docs/mixed.Md": "# Mixed\n",
      "docs/readme.markdown": "# Long\n",
    });
    await mkdir(path.join(root, "docs", "folder.md"));
    const paths = await pathsOf(options(root, { include: ["**/*"] }));
    expect(paths).toEqual(["mixed.Md", "upper.MD"]);
  });

  it("does not list dot files or the contents of dot directories", async () => {
    const root = await makeWorkspace({
      "docs/.hidden.md": "# Hidden\n",
      "docs/.snippets/part.md": "# Part\n",
      "docs/visible.md": "# Visible\n",
    });
    expect(await pathsOf(options(root))).toEqual(["visible.md"]);
  });

  it("never searches .git or node_modules directories", async () => {
    const root = await makeWorkspace({
      "readme.md": "# Root\n",
      "node_modules/pkg/readme.md": "# Package\n",
      "sub/.git/info.md": "# Git\n",
      "sub/node_modules/pkg/readme.md": "# Package\n",
      "sub/page.md": "# Page\n",
    });
    expect(
      await pathsOf(options(root, { contentRoot: ".", include: ["**/*.md", ".git/**/*.md"] })),
    ).toEqual(["readme.md", "sub/page.md"]);
  });

  it("uses the repository root when the content root is a dot", async () => {
    const root = await makeWorkspace({ "a.md": "# A\n", "docs/b.md": "# B\n" });
    expect(await pathsOf(options(root, { contentRoot: "." }))).toEqual(["a.md", "docs/b.md"]);
  });

  it("supports nested content roots", async () => {
    const root = await makeWorkspace({ "site/docs/a.md": "# A\n", "site/other.md": "# O\n" });
    expect(await pathsOf(options(root, { contentRoot: "site/docs" }))).toEqual(["a.md"]);
  });

  it("returns an empty list for a content root without matching files", async () => {
    const root = await makeWorkspace({ "docs/notes.txt": "x" });
    const result = await scanPages(options(root));
    expect(result).toEqual({ ok: true, pages: [], truncated: false });
  });

  it("lists Unicode file and directory names", async () => {
    const root = await makeWorkspace({ "docs/Übersicht/Identität.md": "# Identität\n" });
    expect(await pathsOf(options(root))).toEqual(["Übersicht/Identität.md"]);
  });
});

describe("scanPages: labels", () => {
  it("reads the title, source, aliases, and front matter state of each page", async () => {
    const root = await makeWorkspace({
      "docs/front.md": "---\ntitle: From Front Matter\naliases: [one, two]\n---\n# Heading\n",
      "docs/heading.md": "Intro\n\n# From Heading\n",
      "docs/plain.md": "Only text.\n",
      "docs/broken.md": "---\ntitle: [unclosed\n---\n# Fallback Heading\n",
    });
    const result = await scanPages(options(root));
    expect(result.ok && result.pages).toEqual([
      {
        path: "broken.md",
        fileName: "broken.md",
        title: "Fallback Heading",
        titleSource: "heading",
        aliases: [],
        frontMatter: "invalid",
      },
      {
        path: "front.md",
        fileName: "front.md",
        title: "From Front Matter",
        titleSource: "front-matter",
        aliases: ["one", "two"],
        frontMatter: "ok",
      },
      {
        path: "heading.md",
        fileName: "heading.md",
        title: "From Heading",
        titleSource: "heading",
        aliases: [],
        frontMatter: "none",
      },
      {
        path: "plain.md",
        fileName: "plain.md",
        title: "plain.md",
        titleSource: "filename",
        aliases: [],
        frontMatter: "none",
      },
    ]);
  });

  it("handles an empty file and invalid UTF-8", async () => {
    const root = await makeWorkspace({
      "docs/empty.md": "",
      "docs/binary.md": Buffer.from([0xff, 0xfe, 0x23, 0x20, 0x54, 0x0a]),
    });
    const result = await scanPages(options(root));
    expect(result.ok).toBe(true);
    expect(result.ok && result.pages.map((page) => page.fileName)).toEqual([
      "binary.md",
      "empty.md",
    ]);
  });

  it("reads a byte order mark and CRLF line endings", async () => {
    const root = await makeWorkspace({
      "docs/bom.md": "\uFEFF---\r\ntitle: With BOM\r\n---\r\nBody\r\n",
    });
    const result = await scanPages(options(root));
    expect(result.ok && result.pages[0]?.title).toBe("With BOM");
  });

  it("uses only the beginning of a very large page", async () => {
    const root = await makeWorkspace({
      "docs/large.md": `# Large Page\n\n${"x".repeat(MAX_PAGE_PREFIX_BYTES * 2)}\n`,
    });
    const result = await scanPages(options(root));
    expect(result.ok && result.pages[0]?.title).toBe("Large Page");
  });
});

describe("scanPages: safety", () => {
  it("does not follow symbolic links to files or directories", async () => {
    const root = await makeWorkspace({
      "docs/real.md": "# Real\n",
      "elsewhere/secret.md": "# Secret\n",
    });
    await symlink(path.join(root, "elsewhere", "secret.md"), path.join(root, "docs", "link.md"));
    await symlink(path.join(root, "elsewhere"), path.join(root, "docs", "linked-dir"));
    expect(await pathsOf(options(root))).toEqual(["real.md"]);
  });

  it("rejects a content root that is a symbolic link leaving the workspace folder", async () => {
    const workspace = await makeWorkspace({ "readme.md": "# Root\n" });
    const outside = await makeWorkspace({ "secret.md": "# Secret\n" });
    await symlink(outside, path.join(workspace, "docs"));
    expect(await scanPages(options(workspace))).toEqual({ ok: false, reason: "outside" });
  });

  it("accepts a content root that is a symbolic link inside the workspace folder", async () => {
    const root = await makeWorkspace({ "real/a.md": "# A\n" });
    await symlink(path.join(root, "real"), path.join(root, "docs"));
    expect(await pathsOf(options(root))).toEqual(["a.md"]);
  });

  it("reports a missing content root and a content root that is a file", async () => {
    const root = await makeWorkspace({ docs: "not a directory" });
    expect(await scanPages(options(root))).toEqual({ ok: false, reason: "missing" });
    const empty = await makeWorkspace({ "readme.md": "x" });
    expect(await scanPages(options(empty))).toEqual({ ok: false, reason: "missing" });
  });

  it("reports a missing workspace folder", async () => {
    const root = await makeWorkspace({ "a.md": "x" });
    await rm(root, { recursive: true });
    expect(await resolveContentRoot(root, "docs")).toEqual({ ok: false, reason: "missing" });
  });
});

describe("scanPages: limits, cache, cancellation", () => {
  it("stops at the entry limit and marks the result as incomplete", async () => {
    const files: Record<string, string> = {};
    for (let index = 0; index < 20; index++) {
      files[`docs/page${String(index).padStart(2, "0")}.md`] = `# Page ${String(index)}\n`;
    }
    const root = await makeWorkspace(files);
    const result = await scanPages(options(root, { maxEntries: 5 }));
    expect(result.ok && result.truncated).toBe(true);
    expect(result.ok && result.pages.length).toBeLessThanOrEqual(5);
  });

  it("does not mark a scan as incomplete when it fits the limit", async () => {
    const root = await makeWorkspace({ "docs/a.md": "# A\n", "docs/b.md": "# B\n" });
    const result = await scanPages(options(root, { maxEntries: 2 }));
    expect(result.ok && result.truncated).toBe(false);
  });

  it("returns the same result regardless of the cache", async () => {
    const root = await makeWorkspace({ "docs/a.md": "# A\n", "docs/b/c.md": "# C\n" });
    const cache: PageCache = new Map();
    const first = await scanPages(options(root, { cache }));
    const second = await scanPages(options(root, { cache }));
    const uncached = await scanPages(options(root));
    expect(second).toEqual(first);
    expect(uncached).toEqual(first);
    expect(cache.size).toBe(2);
  });

  it("rereads a page when its size or modification time changed", async () => {
    const root = await makeWorkspace({ "docs/a.md": "# First\n" });
    const cache: PageCache = new Map();
    const before = await scanPages(options(root, { cache }));
    expect(before.ok && before.pages[0]?.title).toBe("First");

    const file = path.join(root, "docs", "a.md");
    await writeFile(file, "# Second title\n");
    const after = await scanPages(options(root, { cache }));
    expect(after.ok && after.pages[0]?.title).toBe("Second title");

    // Same size, different modification time.
    await writeFile(file, "# Other title\n");
    await utimes(file, new Date(2000, 0, 1), new Date(2000, 0, 1));
    const third = await scanPages(options(root, { cache }));
    expect(third.ok && third.pages[0]?.title).toBe("Other title");
  });

  it("reuses cached metadata for an unchanged page", async () => {
    const root = await makeWorkspace({ "docs/a.md": "# Real title\n" });
    const file = path.join(root, "docs", "a.md");
    const { size, mtimeMs } = await import("node:fs/promises").then(({ stat }) => stat(file));
    const cache: PageCache = new Map([
      [
        "a.md",
        {
          size,
          mtimeMs,
          entry: {
            path: "a.md",
            fileName: "a.md",
            title: "Cached title",
            titleSource: "heading",
            aliases: [],
            frontMatter: "none",
          },
        },
      ],
    ]);
    const result = await scanPages(options(root, { cache }));
    expect(result.ok && result.pages[0]?.title).toBe("Cached title");
  });

  it("forgets cached pages that were deleted", async () => {
    const root = await makeWorkspace({ "docs/a.md": "# A\n", "docs/b.md": "# B\n" });
    const cache: PageCache = new Map();
    await scanPages(options(root, { cache }));
    expect([...cache.keys()].sort()).toEqual(["a.md", "b.md"]);
    await rm(path.join(root, "docs", "b.md"));
    await scanPages(options(root, { cache }));
    expect([...cache.keys()]).toEqual(["a.md"]);
  });

  it("reports cancellation instead of a partial list", async () => {
    const root = await makeWorkspace({ "docs/a.md": "# A\n" });
    const controller = new AbortController();
    controller.abort();
    expect(await scanPages(options(root, { signal: controller.signal }))).toEqual({
      ok: false,
      reason: "cancelled",
    });
  });

  it("handles a few hundred pages", async () => {
    const files: Record<string, string> = {};
    for (let index = 0; index < 300; index++) {
      files[`docs/section${String(index % 10)}/page${String(index)}.md`] =
        `# Page ${String(index)}\n`;
    }
    const root = await makeWorkspace(files);
    const paths = await pathsOf(options(root));
    expect(paths).toHaveLength(300);
    expect(paths).toEqual([...paths].sort());
  });
});
