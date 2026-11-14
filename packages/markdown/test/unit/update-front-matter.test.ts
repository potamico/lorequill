import { describe, expect, it } from "vitest";
import {
  applyTextEdits,
  findFrontMatter,
  isAmbiguousPlainString,
  readFrontMatter,
  updateFrontMatter,
} from "../../src/index";
import { apply, blockOf, bodyOf, dataOf, fixture, toCrlf } from "./helpers";

const MATERIAL = fixture("material-constructs.md");
const COMMENTS = fixture("comments-and-unknown-keys.md");

describe("body preservation", () => {
  const edits = [
    [{ op: "set", key: "title", value: "Changed" }],
    [{ op: "set", key: "aliases", value: ["x", "y", "z"] }],
    [{ op: "set", key: "added", value: true }],
    [{ op: "set-date", key: "created", value: "2026-05-06" }],
    [{ op: "remove", key: "status" }],
    [
      { op: "set", key: "title", value: "Several" },
      { op: "set", key: "added", value: "edits" },
      { op: "remove", key: "aliases" },
    ],
  ] as const;

  it.each([
    ["Material for MkDocs constructs", MATERIAL],
    ["comments and unknown keys", COMMENTS],
  ])("never changes the body of %s", (_name, original) => {
    for (const batch of edits) {
      const updated = apply(original, ...batch);
      expect(bodyOf(updated)).toBe(bodyOf(original));
      expect(updated.slice(0, blockOf(updated).start)).toBe("");
    }
  });

  it.each([
    ["Material for MkDocs constructs", MATERIAL],
    ["comments and unknown keys", COMMENTS],
  ])("keeps the CRLF line endings of %s and leaves the body byte-identical", (_name, lf) => {
    const original = toCrlf(lf);
    for (const batch of edits) {
      const updated = apply(original, ...batch);
      expect(bodyOf(updated)).toBe(bodyOf(original));
      // No bare LF anywhere: every line break is still CRLF, including the rewritten lines.
      expect(updated.replace(/\r\n/g, "")).not.toContain("\n");
    }
  });

  it("keeps trailing whitespace, tabs, and the missing final newline of the body", () => {
    const updated = apply(MATERIAL, { op: "set", key: "title", value: "Changed" });
    expect(updated.endsWith("Last line without a trailing newline.")).toBe(true);
    expect(updated).toContain("hard line break at the end of this line.  \n");
    expect(updated).toContain("Text with a tab\tbetween words.");
  });

  it("leaves the front matter delimiters of fenced code in the body alone", () => {
    const updated = apply(MATERIAL, { op: "set", key: "title", value: "Changed" });
    expect(bodyOf(updated)).toContain("```yaml\n---\nnot: front matter\n---\n```");
  });

  it("changes only front matter text, not even a character outside the block", () => {
    const original = MATERIAL;
    const updated = apply(original, { op: "set", key: "title", value: "Changed" });
    const oldBlock = blockOf(original);
    const newBlock = blockOf(updated);
    expect(updated.slice(0, oldBlock.contentStart)).toBe(original.slice(0, oldBlock.contentStart));
    expect(updated.slice(newBlock.contentEnd)).toBe(original.slice(oldBlock.contentEnd));
  });
});

describe("semantic preservation", () => {
  it("changes only the title line and keeps comment, quote style, and everything else", () => {
    const updated = apply(COMMENTS, { op: "set", key: "title", value: "New title" });
    expect(updated).toBe(COMMENTS.replace('title: "Quoted title"', 'title: "New title"'));
  });

  it("replaces only the edited line", () => {
    const result = updateFrontMatter(COMMENTS, [{ op: "set", key: "published", value: true }]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.edits).toHaveLength(1);
      const [edit] = result.edits;
      expect(COMMENTS.slice(edit?.start, edit?.end)).toBe("published: false\n");
      expect(edit?.newText).toBe("published: true\n");
      expect(applyTextEdits(COMMENTS, result.edits)).toBe(result.text);
    }
  });

  it("keeps all other values, unknown keys, and key order", () => {
    const before = dataOf(COMMENTS);
    const after = dataOf(apply(COMMENTS, { op: "set", key: "title", value: "Another" }));
    expect(after).toEqual({ ...before, title: "Another" });
    expect(Object.keys(after)).toEqual(Object.keys(before));
  });

  it("keeps comments when a different field changes", () => {
    const updated = apply(COMMENTS, { op: "set", key: "weight", value: "heavy" });
    expect(updated).toContain("# Top comment that describes the file");
    expect(updated).toContain("# trailing comment on the title");
    expect(updated).toContain("# Unknown keys and nested values must survive edits");
  });

  it("keeps a trailing comment when the commented value is replaced by a different type", () => {
    const original = "---\ntitle: Text # keep me\n---\nBody\n";
    const updated = apply(original, { op: "set", key: "title", value: ["a", "b"] });
    expect(updated).toContain("# keep me");
    expect(dataOf(updated)).toEqual({ title: ["a", "b"] });
  });

  it("keeps the flow style of an existing list", () => {
    const updated = apply(MATERIAL, { op: "set", key: "aliases", value: ["a", "b", "c"] });
    expect(updated).toContain("aliases: [a, b, c]\n");
  });

  it("keeps the block style of an existing list", () => {
    const original = "---\naliases:\n  - one\n  - two\n---\nBody\n";
    const updated = apply(original, { op: "set", key: "aliases", value: ["one", "three"] });
    expect(updated).toBe("---\naliases:\n  - one\n  - three\n---\nBody\n");
  });

  it("keeps aliases a list when it has one entry or none", () => {
    const one = apply("---\ntitle: T\n---\n", { op: "set", key: "aliases", value: ["only"] });
    expect(dataOf(one).aliases).toEqual(["only"]);
    const none = apply(one, { op: "set", key: "aliases", value: [] });
    expect(dataOf(none).aliases).toEqual([]);
  });

  it("does not fold long strings", () => {
    const long = "word ".repeat(200).trim();
    const updated = apply("---\ntitle: T\n---\nBody\n", { op: "set", key: "title", value: long });
    expect(updated).toBe(`---\ntitle: ${long}\n---\nBody\n`);
  });

  it("is idempotent", () => {
    const edit = { op: "set", key: "title", value: "Same" } as const;
    const once = apply(COMMENTS, edit);
    const twice = updateFrontMatter(once, [edit]);
    expect(twice).toEqual({ ok: true, changed: false, edits: [], text: once });
  });
});

describe("operations", () => {
  it("appends a new key at the end of the mapping", () => {
    const updated = apply(MATERIAL, { op: "set", key: "reviewed", value: true });
    expect(updated).toContain("status: draft\nreviewed: true\n---\n");
  });

  it("removes a field and keeps the rest", () => {
    const updated = apply(MATERIAL, { op: "remove", key: "status" });
    expect(dataOf(updated)).toEqual({
      title: "Constructs",
      aliases: ["first alias", "second alias"],
    });
  });

  it("does nothing when removing a field that does not exist", () => {
    const result = updateFrontMatter(MATERIAL, [{ op: "remove", key: "missing" }]);
    expect(result).toEqual({ ok: true, changed: false, edits: [], text: MATERIAL });
  });

  it("does nothing when a value is set to the value it already has", () => {
    expect(updateFrontMatter(MATERIAL, [{ op: "set", key: "title", value: "Constructs" }])).toEqual(
      {
        ok: true,
        changed: false,
        edits: [],
        text: MATERIAL,
      },
    );
    expect(
      updateFrontMatter(COMMENTS, [{ op: "set", key: "title", value: "Quoted title" }]).ok,
    ).toBe(true);
  });

  it("leaves an empty block when the last field is removed", () => {
    const updated = apply(
      MATERIAL,
      { op: "remove", key: "title" },
      { op: "remove", key: "aliases" },
      { op: "remove", key: "status" },
    );
    expect(updated.startsWith("---\n---\n# Constructs")).toBe(true);
    expect(dataOf(updated)).toEqual({});
  });

  it("never writes the word null for an empty mapping", () => {
    const updated = apply("---\ntitle: T\n---\nBody\n", { op: "remove", key: "title" });
    expect(updated).toBe("---\n---\nBody\n");
  });

  it("keeps comments of a front matter that has no fields", () => {
    const original = "---\n# remember this\n---\nBody\n";
    const updated = apply(original, { op: "set", key: "title", value: "T" });
    expect(updated).toContain("# remember this");
    expect(dataOf(updated)).toEqual({ title: "T" });
  });

  it("stores a boolean as a YAML boolean", () => {
    const updated = apply(COMMENTS, { op: "set", key: "published", value: true });
    expect(dataOf(updated).published).toBe(true);
    expect(updated).toContain("published: true\n");
  });

  it("replaces a value of another type", () => {
    const updated = apply(COMMENTS, { op: "set", key: "weight", value: "heavy" });
    expect(dataOf(updated).weight).toBe("heavy");
  });
});

describe("dates", () => {
  it("writes a new date as a quoted string", () => {
    const updated = apply("---\ntitle: T\n---\n", {
      op: "set-date",
      key: "created",
      value: "2026-02-03",
    });
    expect(updated).toContain('created: "2026-02-03"\n');
    expect(dataOf(updated).created).toBe("2026-02-03");
  });

  it("keeps the quote style of an existing date", () => {
    const updated = apply(COMMENTS, { op: "set-date", key: "created", value: "2027-12-31" });
    expect(updated).toContain('created: "2027-12-31"\n');
    const single = apply("---\ncreated: '2026-01-01'\n---\n", {
      op: "set-date",
      key: "created",
      value: "2026-01-02",
    });
    expect(single).toContain("created: '2026-01-02'\n");
  });

  it("quotes an existing unquoted date when it is written", () => {
    const updated = apply("---\ncreated: 2026-01-01\n---\n", {
      op: "set-date",
      key: "created",
      value: "2026-01-02",
    });
    expect(updated).toContain('created: "2026-01-02"\n');
  });

  it.each([
    "2026-02-30",
    "2026-13-01",
    "26-01-01",
    "2026-1-1",
    "2026/01/01",
    "",
    "tomorrow",
    "2026-01-01T00:00",
  ])("rejects the invalid date %j without changing anything", (value) => {
    const result = updateFrontMatter(MATERIAL, [{ op: "set-date", key: "created", value }]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.map((issue) => issue.code)).toEqual(["invalid-date"]);
    }
  });

  it("accepts a leap day only in leap years", () => {
    expect(
      updateFrontMatter("---\n---\n", [{ op: "set-date", key: "d", value: "2028-02-29" }]).ok,
    ).toBe(true);
    expect(
      updateFrontMatter("---\n---\n", [{ op: "set-date", key: "d", value: "2027-02-29" }]).ok,
    ).toBe(false);
  });
});

describe("ambiguous strings", () => {
  const ambiguous = [
    "yes",
    "no",
    "Yes",
    "NO",
    "on",
    "off",
    "y",
    "n",
    "true",
    "False",
    "null",
    "Null",
    "~",
    "",
    "123",
    "-5",
    "+7",
    "1.5",
    ".5",
    "1e3",
    "0x1F",
    "0o17",
    "0b101",
    ".inf",
    ".NaN",
    "1:30",
    "1_000",
    "2026-01-01",
    "2026-1-1",
    "2026-01-01T10:00:00Z",
    "2026-01-01 10:00",
    " padded ",
    "trailing ",
  ];

  it.each(ambiguous)("writes %j quoted and reads it back as the same string", (value) => {
    expect(isAmbiguousPlainString(value)).toBe(true);
    const updated = apply("---\n---\n", { op: "set", key: "field", value });
    expect(updated).not.toBe(`---\nfield: ${value}\n---\n`);
    expect(dataOf(updated).field).toBe(value);
    // The value is quoted, so a YAML 1.1 parser such as PyYAML reads a string too.
    expect(updated).toMatch(/^---\nfield: ["']/);
  });

  it.each(["Hello World", "Identität", "version 2", "a-b", "x: y", "100% sure", "C#", "key=value"])(
    "round-trips the ordinary string %j",
    (value) => {
      const updated = apply("---\n---\n", { op: "set", key: "field", value });
      expect(dataOf(updated).field).toBe(value);
    },
  );

  it("does not quote strings that are unambiguous", () => {
    expect(isAmbiguousPlainString("Hello World")).toBe(false);
    expect(apply("---\n---\n", { op: "set", key: "t", value: "Hello World" })).toBe(
      "---\nt: Hello World\n---\n",
    );
  });

  it("quotes ambiguous list items", () => {
    const updated = apply("---\n---\n", {
      op: "set",
      key: "aliases",
      value: ["yes", "plain", "2026-01-01"],
    });
    expect(dataOf(updated).aliases).toEqual(["yes", "plain", "2026-01-01"]);
    expect(updated).toContain('"yes"');
    expect(updated).toContain('"2026-01-01"');
  });

  it("quotes an ambiguous value even when it replaces a plain string", () => {
    const updated = apply("---\ntitle: plain\n---\n", { op: "set", key: "title", value: "yes" });
    expect(updated).toBe('---\ntitle: "yes"\n---\n');
  });

  it("round-trips multi-line strings and Unicode", () => {
    for (const value of ["line one\nline two", "line one\n\nline three\n", "Ünïcødé ✓ 日本語 😀"]) {
      const updated = apply(COMMENTS, { op: "set", key: "title", value });
      expect(dataOf(updated).title).toBe(value);
      expect(bodyOf(updated)).toBe(bodyOf(COMMENTS));
    }
  });
});

describe("text without front matter", () => {
  const body = "# Heading\n\nBody text.\n";

  it("creates a block in front of the body", () => {
    const updated = apply(body, { op: "set", key: "title", value: "Created" });
    expect(updated).toBe(`---\ntitle: Created\n---\n${body}`);
  });

  it("uses the line ending of the document", () => {
    const crlf = toCrlf(body);
    const updated = apply(crlf, { op: "set", key: "title", value: "Created" });
    expect(updated).toBe(`---\r\ntitle: Created\r\n---\r\n${crlf}`);
  });

  it("keeps a byte order mark in front", () => {
    const updated = apply(`\uFEFF${body}`, { op: "set", key: "title", value: "Created" });
    expect(updated).toBe(`\uFEFF---\ntitle: Created\n---\n${body}`);
  });

  it("works on an empty text", () => {
    expect(apply("", { op: "set", key: "title", value: "Created" })).toBe(
      "---\ntitle: Created\n---\n",
    );
  });

  it("does nothing when removing from front matter that has no fields", () => {
    for (const text of ["---\n---\nBody\n", "---\n# only a comment\n---\nBody\n"]) {
      expect(updateFrontMatter(text, [{ op: "remove", key: "title" }])).toEqual({
        ok: true,
        changed: false,
        edits: [],
        text,
      });
    }
  });

  it("does not create a block for removals", () => {
    expect(updateFrontMatter(body, [{ op: "remove", key: "title" }])).toEqual({
      ok: true,
      changed: false,
      edits: [],
      text: body,
    });
  });

  it("does not treat a thematic break as front matter", () => {
    const text = fixture("no-front-matter.md");
    const updated = apply(text, { op: "set", key: "title", value: "Created" });
    expect(updated).toBe(`---\ntitle: Created\n---\n${text}`);
    expect(bodyOf(updated)).toBe(text);
  });

  it("fills an empty block", () => {
    expect(apply("---\n---\nBody", { op: "set", key: "title", value: "T" })).toBe(
      "---\ntitle: T\n---\nBody",
    );
  });
});

describe("rejected input", () => {
  it("does not rewrite duplicate keys", () => {
    const result = updateFrontMatter(fixture("invalid-front-matter.md"), [
      { op: "set", key: "title", value: "Fixed" },
    ]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.map((issue) => issue.code)).toEqual(["yaml-duplicate-key"]);
      expect(result.issues[0]?.line).toBe(3);
    }
    expect(result).not.toHaveProperty("text");
  });

  it.each([
    ["a syntax error", "title: [unclosed"],
    ["a JavaScript tag", "title: !!js/function 'x'"],
    ["an anchor", "title: &a text"],
    ["a top-level list", "- a\n- b"],
  ])("does not rewrite %s", (_name, yaml) => {
    const text = `---\n${yaml}\n---\nBody\n`;
    const result = updateFrontMatter(text, [{ op: "set", key: "title", value: "Fixed" }]);
    expect(result.ok).toBe(false);
    expect(result).not.toHaveProperty("text");
    expect(result).not.toHaveProperty("edits");
  });

  it.each(["", "a\nb", "a\u0000b", "tab\there".replace("\t", "\u0009")])(
    "rejects the key %j",
    (key) => {
      const result = updateFrontMatter("---\n---\n", [{ op: "set", key, value: "x" }]);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.issues.map((issue) => issue.code)).toEqual(["invalid-key"]);
      }
    },
  );

  it("reports the front matter issues of the complete file with correct lines", () => {
    const text = "# Not front matter\n\n---\ntitle: A\ntitle: B\n---\n";
    expect(findFrontMatter(text)).toBeUndefined();
    const crlf = toCrlf("---\ntitle: A\ntitle: B\n---\n");
    const result = readFrontMatter(crlf);
    expect(result.status === "invalid" && result.issues[0]?.line).toBe(3);
  });
});

describe("safety", () => {
  it("does not pollute Object.prototype when a __proto__ key is written", () => {
    const updated = apply("---\n---\n", { op: "set", key: "__proto__", value: ["a"] });
    expect(({} as Record<string, unknown>).a).toBeUndefined();
    const data = dataOf(updated);
    expect(Object.getPrototypeOf(data)).toBe(Object.prototype);
  });

  it("round-trips pseudo-random titles made of YAML-significant characters", () => {
    // Deterministic generator so failures are reproducible.
    let seed = 20261103;
    const next = (): number => {
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      return seed / 4294967296;
    };
    const alphabet = [
      ...": #-[]{},&*!|>'\"%@`\\\t\n/?=~.+_;<>()$^".split(""),
      ..."abcXYZ019 äöüß日本😀".split(""),
    ];

    for (let index = 0; index < 400; index++) {
      const length = 1 + Math.floor(next() * 24);
      let value = "";
      for (let position = 0; position < length; position++) {
        value += alphabet[Math.floor(next() * alphabet.length)] ?? "";
      }
      const result = updateFrontMatter(COMMENTS, [{ op: "set", key: "title", value }]);
      expect(result.ok, JSON.stringify(value)).toBe(true);
      if (result.ok) {
        expect(dataOf(result.text).title, JSON.stringify(value)).toBe(value);
        expect(bodyOf(result.text)).toBe(bodyOf(COMMENTS));
      }
    }
  });
});
