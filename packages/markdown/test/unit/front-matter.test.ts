import { describe, expect, it } from "vitest";
import { bodyStart, findFrontMatter, readFrontMatter, readFrontMatterField } from "../../src/index";
import { dataOf, fixture, toCrlf } from "./helpers";

describe("findFrontMatter", () => {
  it("returns exact offsets for a simple block", () => {
    const text = "---\ntitle: A\n---\nBody\n";
    expect(findFrontMatter(text)).toEqual({
      start: 0,
      end: 17,
      contentStart: 4,
      contentEnd: 13,
      eol: "\n",
    });
    expect(text.slice(4, 13)).toBe("title: A\n");
    expect(text.slice(17)).toBe("Body\n");
  });

  it("detects CRLF line endings", () => {
    const text = "---\r\ntitle: A\r\n---\r\nBody\r\n";
    const block = findFrontMatter(text);
    expect(block?.eol).toBe("\r\n");
    expect(text.slice(block?.contentStart, block?.contentEnd)).toBe("title: A\r\n");
    expect(text.slice(block?.end)).toBe("Body\r\n");
  });

  it("skips a byte order mark", () => {
    const text = "\uFEFF---\ntitle: A\n---\nBody";
    const block = findFrontMatter(text);
    expect(block?.start).toBe(1);
    expect(text.slice(block?.end)).toBe("Body");
  });

  it("accepts trailing whitespace on delimiter lines", () => {
    const text = "---  \ntitle: A\n---\t\nBody";
    expect(text.slice(findFrontMatter(text)?.end)).toBe("Body");
  });

  it("handles an empty block", () => {
    const text = "---\n---\nBody";
    const block = findFrontMatter(text);
    expect(block?.contentStart).toBe(block?.contentEnd);
    expect(text.slice(block?.end)).toBe("Body");
  });

  it("handles a closing delimiter at the end of the file without a line ending", () => {
    const text = "---\ntitle: A\n---";
    expect(findFrontMatter(text)?.end).toBe(text.length);
  });

  it("closes at the first delimiter, not the last", () => {
    const text = "---\ntitle: A\n---\nBody\n---\nMore\n";
    expect(text.slice(findFrontMatter(text)?.end)).toBe("Body\n---\nMore\n");
  });

  it("does not treat longer dash runs as delimiters", () => {
    const text = "---\ntitle: A\n----\nstill yaml\n---\nBody";
    expect(text.slice(findFrontMatter(text)?.end)).toBe("Body");
  });

  it.each([
    ["an empty text", ""],
    ["no delimiter", "# Heading\n"],
    ["a leading blank line", "\n---\ntitle: A\n---\n"],
    ["leading spaces", " ---\ntitle: A\n---\n"],
    ["no closing delimiter", "---\ntitle: A\n"],
    ["an opening delimiter at the end", "---"],
    ["a longer opening run", "----\ntitle: A\n---\n"],
  ])("finds nothing for %s", (_name, text) => {
    expect(findFrontMatter(text)).toBeUndefined();
    expect(bodyStart(text)).toBe(0);
  });

  it("finds the block in every front matter fixture", () => {
    for (const name of ["material-constructs.md", "comments-and-unknown-keys.md"]) {
      const text = fixture(name);
      expect(findFrontMatter(text), name).toBeDefined();
      expect(findFrontMatter(toCrlf(text)), `${name} (CRLF)`).toBeDefined();
    }
  });

  it("finds nothing in a file that only has a thematic break", () => {
    expect(findFrontMatter(fixture("no-front-matter.md"))).toBeUndefined();
  });
});

describe("readFrontMatter", () => {
  it("returns none without a block", () => {
    expect(readFrontMatter("# Title\n")).toEqual({ status: "none" });
  });

  it("returns an empty mapping for an empty block and for comment-only blocks", () => {
    expect(dataOf("---\n---\n")).toEqual({});
    expect(dataOf("---\n# just a comment\n---\n")).toEqual({});
  });

  it("reads scalars, lists, and nested values", () => {
    const data = dataOf(fixture("comments-and-unknown-keys.md"));
    expect(data).toEqual({
      title: "Quoted title",
      slug: "example-page",
      custom: { nested: "value", list: ["one", "two"] },
      tags: ["alpha", "beta"],
      published: false,
      created: "2026-01-01",
      weight: 10,
    });
  });

  it("reads the same data from LF and CRLF text", () => {
    const text = fixture("comments-and-unknown-keys.md");
    expect(dataOf(toCrlf(text))).toEqual(dataOf(text));
  });

  it("reads dates as strings and YAML 1.1 booleans as strings", () => {
    const data = dataOf("---\ndate: 2026-01-01\nflag: yes\nempty:\n---\n");
    expect(data).toEqual({ date: "2026-01-01", flag: "yes", empty: null });
  });

  it("keeps unknown keys", () => {
    expect(dataOf("---\nfoo: bar\n---\n")).toEqual({ foo: "bar" });
  });

  it("does not pollute Object.prototype through __proto__ keys", () => {
    const data = dataOf("---\n__proto__:\n  polluted: true\n---\n");
    expect(Object.getPrototypeOf(data)).toBe(Object.prototype);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it("reports duplicate keys with a line in the complete file", () => {
    const result = readFrontMatter(fixture("invalid-front-matter.md"));
    expect(result.status).toBe("invalid");
    if (result.status === "invalid") {
      expect(result.issues.map((issue) => issue.code)).toEqual(["yaml-duplicate-key"]);
      expect(result.issues[0]?.line).toBe(3);
    }
  });

  it.each([
    ["a syntax error", "title: [unclosed", "yaml-syntax"],
    ["a JavaScript tag", "title: !!js/function 'x'", "yaml-unsupported-construct"],
    ["a binary tag", "title: !!binary aGk=", "yaml-unsupported-construct"],
    ["a set tag", "title: !!set {a, b}", "yaml-unsupported-construct"],
    ["an anchor", "title: &a text", "yaml-unsupported-construct"],
    ["an alias", "a: &x 1\nb: *x", "yaml-unsupported-construct"],
    ["a list at the top level", "- a\n- b", "front-matter-not-a-mapping"],
    ["a scalar at the top level", "just text", "front-matter-not-a-mapping"],
  ])("rejects %s", (_name, yaml, code) => {
    const result = readFrontMatter(`---\n${yaml}\n---\nBody\n`);
    expect(result.status).toBe("invalid");
    if (result.status === "invalid") {
      expect(result.issues.map((issue) => issue.code)).toContain(code);
      expect(result.issues.every((issue) => issue.line === undefined || issue.line >= 2)).toBe(
        true,
      );
    }
  });

  it("does not interpret the merge key", () => {
    expect(dataOf("---\n<<: {a: 1}\n---\n")).toEqual({ "<<": { a: 1 } });
  });

  it("does not copy front matter values into issue parameters", () => {
    const secret = "super-secret-value";
    const result = readFrontMatter(`---\ntitle: [${secret}\n---\n`);
    expect(JSON.stringify(result)).not.toContain(secret);
  });
});

describe("readFrontMatterField", () => {
  it("returns the value and the line of the key", () => {
    const text = "---\ntitle: Hello\nid: 42\ntags: [a, b]\n---\nBody\n";
    expect(readFrontMatterField(text, "id")).toEqual({ status: "ok", value: 42, line: 3 });
    expect(readFrontMatterField(text, "tags")).toEqual({
      status: "ok",
      value: ["a", "b"],
      line: 4,
    });
  });

  it("reports missing keys and texts without front matter", () => {
    expect(readFrontMatterField("---\ntitle: x\n---\n", "id")).toEqual({ status: "missing" });
    expect(readFrontMatterField("# No front matter\n", "id")).toEqual({ status: "missing" });
  });

  it("reports invalid front matter with a line", () => {
    const result = readFrontMatterField("---\na: 1\na: 2\n---\n", "a");
    expect(result.status).toBe("invalid");
  });
});
