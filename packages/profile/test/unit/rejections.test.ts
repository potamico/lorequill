import { describe, expect, it } from "vitest";
import { parseProfile } from "../../src/index";
import { BASE, issuesOf, lines, summarize } from "./helpers";

/** Appends a `checks.rules` list with the given rule lines to a valid base profile. */
function withRules(...ruleLines: string[]): string {
  return `${BASE}${lines("checks:", "  rules:", ...ruleLines.map((line) => `    ${line}`))}`;
}

describe("top-level structure", () => {
  it.each([
    ["a list", "- a\n- b\n", ["invalid-type"]],
    ["a scalar", "just text\n", ["invalid-type"]],
    ["missing content", "version: 1\n", ["missing-key /content"]],
    ["missing version", "content: { root: docs, include: ['*.md'] }\n", ["missing-key /version"]],
  ])("rejects %s", (_name, yaml, expected) => {
    expect(summarize(issuesOf(yaml))).toEqual(expected);
  });

  it("rejects an unknown top-level key", () => {
    expect(summarize(issuesOf(`${BASE}plugins: []\n`))).toEqual(["unknown-key /plugins"]);
  });

  it("rejects an unknown key inside content", () => {
    expect(summarize(issuesOf(`${BASE}  extra: true\n`))).toEqual(["unknown-key /content/extra"]);
  });

  it("rejects a malformed locale", () => {
    expect(summarize(issuesOf(`${BASE}locale: "not a locale"\n`))).toEqual([
      "invalid-value /locale",
    ]);
  });
});

describe("version", () => {
  it.each([["2"], ["0"], ['"1"'], ["1.5"], ["null"], ["[1]"]])(
    "reports version %s as unsupported with a single issue",
    (version) => {
      const issues = issuesOf(`version: ${version}\ncontent: { root: docs, include: ['*.md'] }\n`);
      expect(summarize(issues)).toEqual(["unsupported-version /version"]);
      expect(issues[0]?.params).toMatchObject({ supported: 1 });
    },
  );

  it("does not run further validation for an unsupported version", () => {
    expect(summarize(issuesOf("version: 2\nunknown: true\n"))).toEqual([
      "unsupported-version /version",
    ]);
  });
});

describe("content", () => {
  const withRoot = (root: string): string =>
    lines("version: 1", "content:", `  root: ${JSON.stringify(root)}`, '  include: ["*.md"]');

  it.each(["docs", "docs/content", ".", "my docs", "docs.v2", "...", ".hidden"])(
    "accepts root %j",
    (root) => {
      expect(parseProfile(withRoot(root)).ok).toBe(true);
    },
  );

  it.each([
    ["an absolute path", "/etc"],
    ["a parent directory", ".."],
    ["a leading parent segment", "../docs"],
    ["an embedded parent segment", "docs/../other"],
    ["a trailing parent segment", "docs/.."],
    ["a trailing slash", "docs/"],
    ["a leading dot segment", "./docs"],
    ["an empty segment", "docs//content"],
    ["a Windows drive path", "C:\\docs"],
    ["backslashes", "docs\\content"],
    ["a colon", "docs:content"],
    ["an empty string", ""],
  ])("rejects a root with %s", (_name, root) => {
    expect(summarize(issuesOf(withRoot(root)))).toEqual(["invalid-value /content/root"]);
  });

  it.each([
    ["an empty include list", "include: []", "invalid-value /content/include"],
    ["a non-array include", "include: '*.md'", "invalid-type /content/include"],
    ["an empty pattern", 'include: [""]', "invalid-value /content/include/0"],
    ["an absolute pattern", 'include: ["/etc/*.md"]', "invalid-value /content/include/0"],
    ["a parent pattern", 'include: ["../*.md"]', "invalid-value /content/include/0"],
    ["an embedded parent", 'include: ["a/../b/*.md"]', "invalid-value /content/include/0"],
    [
      "an absolute draft pattern",
      'include: ["**/*.md"]\n  drafts: ["/drafts/**"]',
      "invalid-value /content/drafts/0",
    ],
    [
      "a parent draft pattern",
      'include: ["**/*.md"]\n  drafts: ["../drafts/**"]',
      "invalid-value /content/drafts/0",
    ],
    ["duplicate patterns", 'include: ["*.md", "*.md"]', "invalid-value /content/include"],
  ])("rejects %s", (_name, includeLine, expected) => {
    const yaml = lines("version: 1", "content:", "  root: docs", `  ${includeLine}`);
    expect(summarize(issuesOf(yaml))).toEqual([expected]);
  });

  it("accepts patterns that merely contain dots", () => {
    const yaml = lines(
      "version: 1",
      "content:",
      "  root: docs",
      '  include: ["..hidden/**", "a..b"]',
    );
    expect(parseProfile(yaml).ok).toBe(true);
  });
});

describe("site", () => {
  const withSite = (url: string, path = "id/{value}/"): string =>
    `${BASE}${lines("site:", `  url: ${JSON.stringify(url)}`, `  stable_links: { field: id, path: ${JSON.stringify(path)} }`)}`;

  it.each([
    ["https://docs.example.org/", "id/{value}/"],
    ["http://localhost:8000/", "{value}.html"],
    ["https://example.org/a/b/", "terms/by-id/{value}/"],
  ])("accepts %j with %j", (url, path) => {
    expect(parseProfile(withSite(url, path)).ok).toBe(true);
  });

  it.each([
    "docs.example.org/",
    "ftp://example.org/",
    "https://example.org",
    "https://example.org/docs",
    "https://example.org/?q=1/",
    "javascript:alert(1)//",
    "https://exa mple.org/",
  ])("rejects the URL %j", (url) => {
    expect(summarize(issuesOf(withSite(url)))).toEqual(["invalid-value /site/url"]);
  });

  it.each([
    "id/",
    "/id/{value}/",
    "../{value}/",
    "id/../{value}/",
    "./{value}",
    "{value}/{value}/",
    "id/{other}/",
    "id {value}/",
    "id/{value}/?x=1",
  ])("rejects the path %j", (path) => {
    expect(summarize(issuesOf(withSite("https://example.org/", path)))).toEqual([
      "invalid-value /site/stable_links/path",
    ]);
  });

  it("requires field and path of stable links", () => {
    expect(summarize(issuesOf(`${BASE}site: { stable_links: { field: id } }\n`))).toEqual([
      "missing-key /site/stable_links/path",
    ]);
  });
});

describe("review.base_branch", () => {
  const withBranch = (branch: string): string =>
    `${BASE}${lines("review:", `  base_branch: ${JSON.stringify(branch)}`)}`;

  it.each(["main", "release/1.0", "feature/a_b-c", "a", "v1.2.3", "topic/日本語"])(
    "accepts %j",
    (branch) => {
      expect(parseProfile(withBranch(branch)).ok).toBe(true);
    },
  );

  it.each([
    ["an option-like name", "--upload-pack=evil"],
    ["a single leading hyphen", "-x"],
    ["a leading slash", "/main"],
    ["a trailing slash", "main/"],
    ["a trailing dot", "main."],
    ["consecutive dots", "a..b"],
    ["consecutive slashes", "a//b"],
    ["a space", "my branch"],
    ["a tab", "a\tb"],
    ["a .lock suffix", "main.lock"],
    ["a .lock component", "a.lock/b"],
    ["a hidden component", "a/.b"],
    ["a leading dot", ".hidden"],
    ["the reserved name @", "@"],
    ["a reflog sequence", "a@{1}"],
    ["a tilde", "a~1"],
    ["a caret", "a^"],
    ["a colon", "a:b"],
    ["a question mark", "a?"],
    ["an asterisk", "a*"],
    ["an opening bracket", "a[b"],
    ["a backslash", "a\\b"],
    ["a control character", "a\u0001b"],
    ["an empty name", ""],
  ])("rejects %s", (_name, branch) => {
    expect(summarize(issuesOf(withBranch(branch)))).toEqual(["invalid-value /review/base_branch"]);
  });

  it("requires base_branch inside review", () => {
    expect(summarize(issuesOf(`${BASE}review: {}\n`))).toEqual(["missing-key /review/base_branch"]);
  });

  it("rejects unknown review keys", () => {
    expect(summarize(issuesOf(`${BASE}review: { base_branch: main, remote: origin }\n`))).toEqual([
      "unknown-key /review/remote",
    ]);
  });
});

describe("checks", () => {
  it.each([0, -1, 301, 1.5])("rejects timeout_seconds %s", (value) => {
    const issues = issuesOf(`${BASE}checks: { timeout_seconds: ${String(value)} }\n`);
    expect(summarize(issues).length).toBe(1);
    expect(issues[0]?.path).toBe("/checks/timeout_seconds");
  });

  it('rejects a string timeout_seconds ("30")', () => {
    expect(summarize(issuesOf(`${BASE}checks: { timeout_seconds: "30" }\n`))).toEqual([
      "invalid-type /checks/timeout_seconds",
    ]);
  });

  it.each([1, 30, 300])("accepts timeout_seconds %s", (value) => {
    expect(parseProfile(`${BASE}checks: { timeout_seconds: ${String(value)} }\n`).ok).toBe(true);
  });

  it("rejects per-rule timeouts", () => {
    const yaml = withRules("- { id: a, rule: forbidden-text, text: x, timeout_seconds: 5 }");
    expect(summarize(issuesOf(yaml))).toEqual(["unknown-key /checks/rules/0/timeout_seconds"]);
  });

  it("rejects unknown keys in checks", () => {
    expect(summarize(issuesOf(`${BASE}checks: { retries: 3 }\n`))).toEqual([
      "unknown-key /checks/retries",
    ]);
  });
});

describe("check rules: unsafe and unknown constructs", () => {
  it.each(["argv", "command", "shell", "script", "exec", "executable", "run", "regex", "pattern"])(
    "rejects the parameter %s",
    (key) => {
      const yaml = withRules(`- { id: a, rule: forbidden-text, text: x, ${key}: anything }`);
      expect(summarize(issuesOf(yaml))).toEqual([`unknown-key /checks/rules/0/${key}`]);
    },
  );

  it("rejects argv as a list on every rule type", () => {
    const yaml = withRules(
      "- { id: a, rule: forbidden-text, text: x, argv: [git, status] }",
      "- { id: b, rule: unique-field, field: f, argv: [sh] }",
      "- { id: c, rule: allow-values, marker: 'm:', values: [x], argv: [sh] }",
      "- { id: d, rule: relative-links, argv: [sh] }",
      "- { id: e, rule: field-format, field: f, prefixes: [AB], argv: [sh] }",
    );
    expect(summarize(issuesOf(yaml))).toEqual([
      "unknown-key /checks/rules/0/argv",
      "unknown-key /checks/rules/1/argv",
      "unknown-key /checks/rules/2/argv",
      "unknown-key /checks/rules/3/argv",
      "unknown-key /checks/rules/4/argv",
    ]);
  });

  it.each(["regex", "shell", "command", "script", "forbidden_text", "Forbidden-Text", "exec", "1"])(
    "rejects the unknown rule %s",
    (rule) => {
      const issues = issuesOf(withRules(`- { id: a, rule: ${JSON.stringify(rule)}, text: x }`));
      expect(summarize(issues)).toEqual(["unknown-rule /checks/rules/0/rule"]);
    },
  );

  it("rejects a rule without a rule name", () => {
    expect(summarize(issuesOf(withRules("- { id: a, text: x }")))).toEqual([
      "missing-key /checks/rules/0/rule",
    ]);
  });

  it("rejects a non-string rule name", () => {
    expect(summarize(issuesOf(withRules("- { id: a, rule: [x] }")))).toEqual([
      "invalid-type /checks/rules/0/rule",
    ]);
  });

  it("rejects a rule that is not a mapping", () => {
    expect(issuesOf(withRules("- forbidden-text")).length).toBeGreaterThan(0);
  });

  it("rejects parameters that belong to a different rule", () => {
    const yaml = withRules("- { id: a, rule: unique-field, field: f, text: x }");
    expect(summarize(issuesOf(yaml))).toEqual(["unknown-key /checks/rules/0/text"]);
  });
});

describe("check rules: parameters", () => {
  it.each([
    ["missing id", "- { rule: forbidden-text, text: x }", "missing-key /checks/rules/0/id"],
    [
      "uppercase id",
      "- { id: Bad, rule: forbidden-text, text: x }",
      "invalid-value /checks/rules/0/id",
    ],
    [
      "id with spaces",
      "- { id: 'a b', rule: forbidden-text, text: x }",
      "invalid-value /checks/rules/0/id",
    ],
    [
      "id too long",
      `- { id: ${"a".repeat(65)}, rule: forbidden-text, text: x }`,
      "invalid-value /checks/rules/0/id",
    ],
    ["missing text", "- { id: a, rule: forbidden-text }", "missing-key /checks/rules/0/text"],
    [
      "empty text",
      "- { id: a, rule: forbidden-text, text: '' }",
      "invalid-value /checks/rules/0/text",
    ],
    [
      "text over 200 characters",
      `- { id: a, rule: forbidden-text, text: ${"x".repeat(201)} }`,
      "invalid-value /checks/rules/0/text",
    ],
    [
      "numeric text",
      "- { id: a, rule: forbidden-text, text: 5 }",
      "invalid-type /checks/rules/0/text",
    ],
    [
      "unique-field without field",
      "- { id: a, rule: unique-field }",
      "missing-key /checks/rules/0/field",
    ],
    [
      "unique-field with invalid key",
      "- { id: a, rule: unique-field, field: 'a b' }",
      "invalid-value /checks/rules/0/field",
    ],
    [
      "allow-values without marker",
      "- { id: a, rule: allow-values, values: [x] }",
      "missing-key /checks/rules/0/marker",
    ],
    [
      "allow-values without values",
      "- { id: a, rule: allow-values, marker: 'm:' }",
      "missing-key /checks/rules/0/values",
    ],
    [
      "allow-values with empty values",
      "- { id: a, rule: allow-values, marker: 'm:', values: [] }",
      "invalid-value /checks/rules/0/values",
    ],
    [
      "allow-values with duplicate values",
      "- { id: a, rule: allow-values, marker: 'm:', values: [x, x] }",
      "invalid-value /checks/rules/0/values",
    ],
    [
      "relative-links with bad slugify",
      "- { id: a, rule: relative-links, slugify: latin }",
      "invalid-value /checks/rules/0/slugify",
    ],
    [
      "relative-links with string anchors",
      "- { id: a, rule: relative-links, anchors: 'yes' }",
      "invalid-type /checks/rules/0/anchors",
    ],
    [
      "field-format without prefixes",
      "- { id: a, rule: field-format, field: f }",
      "missing-key /checks/rules/0/prefixes",
    ],
    [
      "field-format with digit prefix",
      "- { id: a, rule: field-format, field: f, prefixes: [AB1] }",
      "invalid-value /checks/rules/0/prefixes/0",
    ],
    [
      "field-format with hyphen prefix",
      "- { id: a, rule: field-format, field: f, prefixes: [A-B] }",
      "invalid-value /checks/rules/0/prefixes/0",
    ],
    [
      "field-format with 21-letter prefix",
      `- { id: a, rule: field-format, field: f, prefixes: [${"A".repeat(21)}] }`,
      "invalid-value /checks/rules/0/prefixes/0",
    ],
    [
      "field-format with empty prefixes",
      "- { id: a, rule: field-format, field: f, prefixes: [] }",
      "invalid-value /checks/rules/0/prefixes",
    ],
    [
      "field-format when without in",
      "- { id: a, rule: field-format, field: f, prefixes: [AB], when: { field: t } }",
      "missing-key /checks/rules/0/when/in",
    ],
    [
      "field-format when with unknown key",
      "- { id: a, rule: field-format, field: f, prefixes: [AB], when: { field: t, in: [x], regex: y } }",
      "unknown-key /checks/rules/0/when/regex",
    ],
  ])("rejects %s", (_name, rule, expected) => {
    expect(summarize(issuesOf(withRules(rule)))).toEqual([expected]);
  });

  it("accepts a 20-letter prefix and a 200-character text", () => {
    const yaml = withRules(
      `- { id: a, rule: field-format, field: f, prefixes: [${"A".repeat(20)}] }`,
      `- { id: b, rule: forbidden-text, text: ${"x".repeat(200)} }`,
    );
    expect(parseProfile(yaml).ok).toBe(true);
  });

  it("rejects duplicate check IDs", () => {
    const yaml = withRules(
      "- { id: same, rule: forbidden-text, text: a }",
      "- { id: other, rule: forbidden-text, text: b }",
      "- { id: same, rule: unique-field, field: f }",
    );
    expect(summarize(issuesOf(yaml))).toEqual(["duplicate-id /checks/rules/2/id"]);
  });
});

describe("collections", () => {
  const withCollection = (...collectionLines: string[]): string =>
    `${BASE}${lines("collections:", ...collectionLines.map((line) => `  ${line}`))}`;

  it.each(["{domain}/concepts", "concepts", "a/b/c", "{domain}", "{domain}/{domain}"])(
    "accepts folder %j",
    (folder) => {
      expect(
        parseProfile(withCollection(`- { id: c, folder: ${JSON.stringify(folder)} }`)).ok,
      ).toBe(true);
    },
  );

  it.each([
    ["an absolute folder", "/concepts"],
    ["a parent segment", "../concepts"],
    ["an embedded parent segment", "a/../b"],
    ["a partial placeholder", "{domain}x"],
    ["an unknown placeholder", "{other}/x"],
    ["an unterminated placeholder", "{domain"],
    ["a backslash", "a\\b"],
    ["a trailing slash", "a/"],
    ["an empty folder", ""],
  ])("rejects %s", (_name, folder) => {
    const yaml = withCollection(`- { id: c, folder: ${JSON.stringify(folder)} }`);
    expect(summarize(issuesOf(yaml))).toEqual(["invalid-value /collections/0/folder"]);
  });

  it("requires id and folder", () => {
    expect(summarize(issuesOf(withCollection("- { label: x }")))).toEqual([
      "missing-key /collections/0/id",
      "missing-key /collections/0/folder",
    ]);
  });

  it("rejects duplicate collection IDs", () => {
    const yaml = withCollection("- { id: c, folder: a }", "- { id: c, folder: b }");
    expect(summarize(issuesOf(yaml))).toEqual(["duplicate-id /collections/1/id"]);
  });

  it("rejects unknown collection keys", () => {
    expect(summarize(issuesOf(withCollection("- { id: c, folder: a, script: x }")))).toEqual([
      "unknown-key /collections/0/script",
    ]);
  });

  it("rejects an incomplete match filter", () => {
    expect(
      summarize(issuesOf(withCollection("- { id: c, folder: a, match: { field: t } }"))),
    ).toEqual(["missing-key /collections/0/match/equals"]);
  });
});

describe("collection fields", () => {
  const withFields = (...fieldLines: string[]): string =>
    `${BASE}${lines(
      "collections:",
      "  - id: c",
      "    folder: a",
      "    fields:",
      ...fieldLines.map((line) => `      ${line}`),
    )}`;

  it.each(["string", "text", "select", "list", "boolean", "date", "hidden"])(
    "accepts the widget %s",
    (widget) => {
      const extra = widget === "select" ? ", options: [a]" : "";
      expect(parseProfile(withFields(`- { key: k, widget: ${widget}${extra} }`)).ok).toBe(true);
    },
  );

  it.each([["slider"], ["checkbox"], ["markdown"], ["STRING"]])(
    "rejects the unknown widget %s",
    (widget) => {
      expect(summarize(issuesOf(withFields(`- { key: k, widget: ${widget} }`)))).toEqual([
        "unknown-widget /collections/0/fields/0/widget",
      ]);
    },
  );

  it("requires a widget", () => {
    expect(summarize(issuesOf(withFields("- { key: k }")))).toEqual([
      "missing-key /collections/0/fields/0/widget",
    ]);
  });

  it("requires options for select", () => {
    expect(summarize(issuesOf(withFields("- { key: k, widget: select }")))).toEqual([
      "missing-key /collections/0/fields/0/options",
    ]);
  });

  it("rejects options on widgets that do not use them", () => {
    expect(summarize(issuesOf(withFields("- { key: k, widget: string, options: [a] }")))).toEqual([
      "unknown-key /collections/0/fields/0/options",
    ]);
  });

  it("rejects a select default that is not an option", () => {
    const yaml = withFields("- { key: k, widget: select, options: [a, b], default: c }");
    expect(summarize(issuesOf(yaml))).toEqual(["invalid-default /collections/0/fields/0/default"]);
  });

  it("accepts a select default that is an option", () => {
    expect(
      parseProfile(withFields("- { key: k, widget: select, options: [a, b], default: b }")).ok,
    ).toBe(true);
  });

  it.each([
    [
      "boolean with a string default",
      "{ key: k, widget: boolean, default: 'true' }",
      "invalid-type",
    ],
    ["string with a boolean default", "{ key: k, widget: string, default: true }", "invalid-type"],
    ["list with a string default", "{ key: k, widget: list, default: x }", "invalid-type"],
  ])("rejects a %s", (_name, field, code) => {
    expect(summarize(issuesOf(withFields(`- ${field}`)))).toEqual([
      `${code} /collections/0/fields/0/default`,
    ]);
  });

  it("rejects duplicate field keys within a collection", () => {
    const yaml = withFields("- { key: k, widget: string }", "- { key: k, widget: text }");
    expect(summarize(issuesOf(yaml))).toEqual(["duplicate-field-key /collections/0/fields/1/key"]);
  });

  it("allows the same field key in different collections", () => {
    const yaml = `${BASE}${lines(
      "collections:",
      "  - { id: a, folder: a, fields: [{ key: k, widget: string }] }",
      "  - { id: b, folder: b, fields: [{ key: k, widget: string }] }",
    )}`;
    expect(parseProfile(yaml).ok).toBe(true);
  });

  it("rejects unsafe field keys", () => {
    expect(summarize(issuesOf(withFields("- { key: '__proto__ x', widget: string }")))).toEqual([
      "invalid-value /collections/0/fields/0/key",
    ]);
  });
});

describe("issue locations", () => {
  it("points an unknown key at the key itself", () => {
    const yaml = lines(
      "version: 1",
      "content:",
      "  root: docs",
      '  include: ["*.md"]',
      "  argv: x",
    );
    expect(issuesOf(yaml)[0]).toMatchObject({ code: "unknown-key", line: 5, column: 3 });
  });

  it("points an invalid value at the value", () => {
    const yaml = lines("version: 1", "content:", "  root: /etc", '  include: ["*.md"]');
    expect(issuesOf(yaml)[0]).toMatchObject({ code: "invalid-value", line: 3, column: 9 });
  });

  it("points a missing key at the enclosing mapping", () => {
    const yaml = lines("version: 1", "content:", "  root: docs");
    const issue = issuesOf(yaml)[0];
    expect(issue?.code).toBe("missing-key");
    expect(issue?.line).toBe(3);
  });

  it("points an unknown rule at the rule name", () => {
    const yaml = withRules("- { id: a, rule: regex, text: x }");
    expect(issuesOf(yaml)[0]).toMatchObject({ code: "unknown-rule", line: 7 });
  });
});
