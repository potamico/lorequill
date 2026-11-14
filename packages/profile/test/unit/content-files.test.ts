import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { listContentFiles } from "../../src/content-files";

describe("listContentFiles", () => {
  let root: string;

  async function file(path: string): Promise<void> {
    const absolute = join(root, ...path.split("/"));
    await mkdir(join(absolute, ".."), { recursive: true });
    await writeFile(absolute, "# Page\n");
  }

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "lq-content-"));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("lists regular files sorted, skipping .git, node_modules, and symbolic links", async () => {
    await file("b.md");
    await file("a/z.md");
    await file("a/image.png");
    await file(".git/config");
    await file("deep/node_modules/x.md");
    await symlink(join(root, "b.md"), join(root, "link.md"));
    await symlink(join(root, "a"), join(root, "linked-dir"));
    expect(await listContentFiles(root)).toEqual({
      files: ["a/image.png", "a/z.md", "b.md"],
      truncated: false,
    });
  });

  it("keeps only accepted files, which still count toward the limit", async () => {
    await file("a.md");
    await file("b.txt");
    expect(await listContentFiles(root, { accept: (path) => path.endsWith(".md") })).toEqual({
      files: ["a.md"],
      truncated: false,
    });
    expect(
      await listContentFiles(root, { maxEntries: 1, accept: (path) => path.endsWith(".md") }),
    ).toMatchObject({ truncated: true });
  });

  it("goes breadth first, so a truncated listing keeps the pages nearest to the root", async () => {
    await file("deep/deeper/deepest.md");
    await file("top.md");
    // Root entries: `deep` and `top.md`; then `deeper`; the limit stops before `deepest.md`.
    expect(await listContentFiles(root, { maxEntries: 3 })).toEqual({
      files: ["top.md"],
      truncated: true,
    });
  });

  it("skips a missing root and rejects when aborted", async () => {
    expect(await listContentFiles(join(root, "missing"))).toEqual({ files: [], truncated: false });
    const controller = new AbortController();
    controller.abort();
    await expect(listContentFiles(root, { signal: controller.signal })).rejects.toThrow();
  });
});
