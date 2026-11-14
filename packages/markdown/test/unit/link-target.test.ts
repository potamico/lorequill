import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createFileSystemTargetProvider,
  relativeLinkPath,
  resolveLinkDestination,
} from "../../src";

describe("resolveLinkDestination", () => {
  const resolve = (destination: string, source = "guides/setup.md") =>
    resolveLinkDestination(source, destination);

  it("resolves relative paths against the source page", () => {
    expect(resolve("install.md")).toEqual({ kind: "path", path: "guides/install.md" });
    expect(resolve("./sub/a.md")).toEqual({ kind: "path", path: "guides/sub/a.md" });
    expect(resolve("../index.md")).toEqual({ kind: "path", path: "index.md" });
    expect(resolve("a.md", "root.md")).toEqual({ kind: "path", path: "a.md" });
  });

  it("allows .. inside the content root and rejects escapes", () => {
    expect(resolve("../guides/../other/x.md")).toEqual({ kind: "path", path: "other/x.md" });
    expect(resolve("../../outside.md")).toEqual({
      kind: "invalid",
      reason: "outside-content-root",
    });
    expect(resolve("..", "root.md")).toEqual({ kind: "invalid", reason: "outside-content-root" });
  });

  it("splits and decodes fragments and ignores queries", () => {
    expect(resolve("a.md#Teil%20eins")).toEqual({
      kind: "path",
      path: "guides/a.md",
      fragment: "Teil eins",
    });
    expect(resolve("a.md?x=1#f")).toEqual({ kind: "path", path: "guides/a.md", fragment: "f" });
    expect(resolve("#local")).toEqual({ kind: "same-page", fragment: "local" });
    expect(resolve("#")).toEqual({ kind: "same-page", fragment: "" });
  });

  it("percent-decodes paths", () => {
    expect(resolve("with%20space.md")).toEqual({ kind: "path", path: "guides/with space.md" });
    expect(resolve("%C3%A4.md")).toEqual({ kind: "path", path: "guides/ä.md" });
  });

  it("classifies schemes", () => {
    expect(resolve("https://example.com/a.md")).toEqual({ kind: "external", scheme: "https" });
    expect(resolve("HTTP://example.com")).toEqual({ kind: "external", scheme: "http" });
    expect(resolve("mailto:a@example.com")).toEqual({ kind: "external", scheme: "mailto" });
    for (const destination of ["file:///etc/passwd", "javascript:alert(1)", "ftp://x", "data:,x"]) {
      expect(resolve(destination), destination).toEqual({
        kind: "invalid",
        reason: "unsupported-scheme",
      });
    }
  });

  it("rejects absolute paths, backslashes, malformed encoding, and empty destinations", () => {
    expect(resolve("/docs/a.md")).toEqual({ kind: "invalid", reason: "absolute-path" });
    expect(resolve("//server/share")).toEqual({ kind: "invalid", reason: "absolute-path" });
    expect(resolve("C:\\docs\\a.md")).toEqual({ kind: "invalid", reason: "absolute-path" });
    expect(resolve("%2Fetc%2Fpasswd")).toEqual({ kind: "invalid", reason: "absolute-path" });
    expect(resolve("sub\\a.md")).toEqual({ kind: "invalid", reason: "backslash" });
    expect(resolve("sub%5Ca.md")).toEqual({ kind: "invalid", reason: "backslash" });
    expect(resolve("a%zz.md")).toEqual({ kind: "invalid", reason: "malformed-encoding" });
    expect(resolve("a%00.md")).toEqual({ kind: "invalid", reason: "malformed-encoding" });
    expect(resolve("")).toEqual({ kind: "invalid", reason: "empty" });
  });

  it("normalizes a trailing slash and the root itself", () => {
    expect(resolve("sub/")).toEqual({ kind: "path", path: "guides/sub" });
    expect(resolve("..")).toEqual({ kind: "path", path: "." });
  });
});

describe("relativeLinkPath", () => {
  it("builds POSIX paths relative to the source directory", () => {
    expect(relativeLinkPath("guides/setup.md", "guides/install.md")).toBe("install.md");
    expect(relativeLinkPath("guides/setup.md", "index.md")).toBe("../index.md");
    expect(relativeLinkPath("index.md", "guides/deep/x.md")).toBe("guides/deep/x.md");
    expect(relativeLinkPath("a/b.md", "c/d.md")).toBe("../c/d.md");
    expect(relativeLinkPath("same.md", "same.md")).toBe("same.md");
  });

  it("encodes characters that would break a destination and keeps Unicode letters", () => {
    expect(relativeLinkPath("a.md", "With spaces (new).md")).toBe("With%20spaces%20%28new%29.md");
    expect(relativeLinkPath("a.md", "50%#?.md")).toBe("50%25%23%3F.md");
    expect(relativeLinkPath("a.md", "identität.md")).toBe("identität.md");
  });

  it("appends an encoded fragment", () => {
    expect(relativeLinkPath("a.md", "b.md", "teil eins")).toBe("b.md#teil%20eins");
    expect(relativeLinkPath("a.md", "b.md", "")).toBe("b.md");
  });

  it("round-trips through the resolver", () => {
    const cases: [string, string, string?][] = [
      ["guides/setup.md", "index.md", "intro"],
      ["a/b/c.md", "a/x y/(z)#.md"],
      ["index.md", "deutsch/größe ü.md", "größe"],
    ];
    for (const [source, target, fragment] of cases) {
      const destination = relativeLinkPath(source, target, fragment);
      expect(resolveLinkDestination(source, destination)).toEqual(
        fragment === undefined
          ? { kind: "path", path: target }
          : { kind: "path", path: target, fragment },
      );
    }
  });
});

describe("createFileSystemTargetProvider", () => {
  let base: string;
  let root: string;

  beforeAll(async () => {
    base = await mkdtemp(join(tmpdir(), "lorequill-targets-"));
    root = join(base, "docs");
    await mkdir(join(root, "sub"), { recursive: true });
    await writeFile(join(root, "page.md"), "# Page\n");
    await writeFile(join(root, "sub", "file.pdf"), "pdf");
    await writeFile(join(base, "secret.md"), "# Secret\n");
    await symlink(join(base, "secret.md"), join(root, "escape.md"));
    await symlink(join(root, "page.md"), join(root, "alias.md"));
    await symlink(base, join(root, "parent"));
  });

  afterAll(async () => {
    await rm(base, { recursive: true, force: true });
  });

  it("describes files, directories, and missing paths", async () => {
    const provider = createFileSystemTargetProvider(root);
    expect(await provider.describe("page.md")).toBe("file");
    expect(await provider.describe("sub/file.pdf")).toBe("file");
    expect(await provider.describe("sub")).toBe("directory");
    expect(await provider.describe(".")).toBe("directory");
    expect(await provider.describe("missing.md")).toBe("missing");
  });

  it("requires exact case", async () => {
    const provider = createFileSystemTargetProvider(root);
    expect(await provider.describe("Page.md")).toBe("missing");
    expect(await provider.describe("SUB/file.pdf")).toBe("missing");
  });

  it("reports symbolic links that resolve outside the content root", async () => {
    const provider = createFileSystemTargetProvider(root);
    expect(await provider.describe("escape.md")).toBe("outside");
    expect(await provider.describe("parent/secret.md")).toBe("outside");
    expect(await provider.describe("alias.md")).toBe("file");
  });

  it("reads only regular files inside the content root", async () => {
    const provider = createFileSystemTargetProvider(root);
    expect(await provider.readText("page.md")).toBe("# Page\n");
    expect(await provider.readText("escape.md")).toBeUndefined();
    expect(await provider.readText("sub")).toBeUndefined();
  });
});
