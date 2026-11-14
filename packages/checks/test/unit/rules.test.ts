import type { CheckRule } from "@lorequill/profile";
import { describe, expect, it } from "vitest";
import { normalizeUniqueValue, runChecks, type CheckResult } from "../../src";
import { memorySnapshot, profileWith } from "./helpers";

async function check(rule: CheckRule, files: Record<string, string>): Promise<CheckResult> {
  return runChecks({ profile: profileWith([rule]), snapshot: memorySnapshot(files) });
}

function summary(result: CheckResult): string[] {
  return result.findings.map(
    ({ path, line, column, code }) =>
      `${path}:${String(line)}${column === undefined ? "" : `:${String(column)}`} ${code}`,
  );
}

describe("forbidden-text", () => {
  const rule: CheckRule = { id: "wikilinks", rule: "forbidden-text", text: "[[" };

  it("reports one finding per matching line at the first occurrence", async () => {
    const result = await check(rule, { "a.md": "ok\nsee [[one]] and [[two]]\n---\n[[x\n" });
    expect(summary(result)).toEqual([
      "docs/a.md:2:5 forbidden-text/found",
      "docs/a.md:4:1 forbidden-text/found",
    ]);
    expect(result.findings[0]?.message).toBe('Forbidden text "[[" found.');
  });

  it("is literal and case-sensitive", async () => {
    const todo: CheckRule = { id: "todo", rule: "forbidden-text", text: "TODO.*" };
    expect((await check(todo, { "a.md": "todo.* TODO and TODOs\n" })).status).toBe("passed");
    expect((await check(todo, { "a.md": "x TODO.* y\n" })).status).toBe("failed");
  });
});

describe("allow-values", () => {
  const rule: CheckRule = {
    id: "relations",
    rule: "allow-values",
    marker: "rel:",
    values: ["related", "supports"],
  };

  it("checks the trimmed value after the first marker, removing one backtick pair", async () => {
    const result = await check(rule, {
      "a.md":
        "rel: related\n- rel:   `supports`  \nrel: Related\nrel: ``supports``\nrel:\nno marker\n",
    });
    expect(summary(result)).toEqual([
      "docs/a.md:3:1 allow-values/not-allowed",
      "docs/a.md:4:1 allow-values/not-allowed",
      "docs/a.md:5:1 allow-values/not-allowed",
    ]);
    expect(result.findings.map(({ params }) => params.value)).toEqual([
      "Related",
      "`supports`",
      "",
    ]);
  });
});

describe("unique-field", () => {
  const rule: CheckRule = { id: "ids", rule: "unique-field", field: "id" };

  it("reports duplicates after normalization on later pages, naming the first page", async () => {
    const result = await check(rule, {
      "b.md": "---\nid: bok-1\n---\n",
      "a.md": "---\ntitle: A\nid: BOK-1\n---\n",
      "c.md": "---\nid: ' BOK-1 '\n---\n",
      "d.md": "---\nid: BOK-2\n---\n",
    });
    expect(summary(result)).toEqual([
      "docs/b.md:2 unique-field/duplicate",
      "docs/c.md:2 unique-field/duplicate",
    ]);
    expect(result.findings[0]?.params).toMatchObject({ first: "docs/a.md", value: "bok-1" });
  });

  it("compares numbers and strings by their text and ignores empty values", async () => {
    const result = await check(rule, {
      "a.md": "---\nid: 7\n---\n",
      "b.md": "---\nid: '7'\n---\n",
      "c.md": "---\nid: ''\n---\n",
      "d.md": "---\nid:\n---\n",
      "e.md": "---\nid: ''\n---\n",
      "f.md": "# No front matter\n",
    });
    expect(summary(result)).toEqual(["docs/b.md:2 unique-field/duplicate"]);
  });

  it("reports non-scalar values and unreadable front matter", async () => {
    const result = await check(rule, {
      "a.md": "---\nid: [a, b]\n---\n",
      "b.md": "---\nid: a\nid: b\n---\n",
    });
    expect(summary(result).map((line) => line.split(" ")[1])).toEqual([
      "unique-field/not-scalar",
      "front-matter/invalid",
    ]);
  });

  it("normalizes like decision D10", () => {
    expect(normalizeUniqueValue("  BOK\t 1 ")).toBe("bok 1");
    expect(normalizeUniqueValue("Identität")).toBe(normalizeUniqueValue("Identität"));
    expect(normalizeUniqueValue(true)).toBe("true");
  });
});

describe("field-format", () => {
  const rule: CheckRule = {
    id: "decision-ids",
    rule: "field-format",
    field: "id",
    prefixes: ["DEC", "ADR"],
    when: { field: "type", in: ["decision", "adr"] },
  };

  it("accepts PREFIX-digits and rejects other values on pages in scope", async () => {
    const result = await check(rule, {
      "a.md": "---\ntype: decision\nid: DEC-12\n---\n",
      "b.md": "---\ntype: adr\nid: ADR-7\n---\n",
      "c.md": "---\ntype: adr\nid: dec-7\n---\n",
      "d.md": "---\ntype: decision\nid: DEC-\n---\n",
      "e.md": "---\ntype: decision\n---\n",
      "f.md": "---\ntype: decision\nid: 42\n---\n",
      "g.md": "---\ntype: concept\nid: whatever\n---\n",
      "h.md": "# No front matter\n",
    });
    expect(summary(result)).toEqual([
      "docs/c.md:3 field-format/invalid",
      "docs/d.md:3 field-format/invalid",
      "docs/e.md:1 field-format/missing",
      "docs/f.md:3 field-format/invalid",
    ]);
    expect(result.findings[0]?.message).toBe(
      'Value "dec-7" of "id" must look like DEC-123 or ADR-123 (prefix, hyphen, digits).',
    );
  });

  it("applies to every page without a when filter", async () => {
    const all: CheckRule = { id: "ids", rule: "field-format", field: "id", prefixes: ["KO"] };
    const result = await check(all, { "a.md": "# A\n", "b.md": "---\nid: KO-1\n---\n" });
    expect(summary(result)).toEqual(["docs/a.md:1 field-format/missing"]);
  });
});

describe("reference-field", () => {
  const rule: CheckRule = {
    id: "successors",
    rule: "reference-field",
    field: "replaced_by",
    target: "id",
    when: { field: "lifecycle", in: ["Retired"] },
    required: true,
  };
  const page = (fields: string): string => `---\n${fields}\n---\n# Page\n`;

  it("accepts references to other pages, as a value or a list, compared like unique-field", async () => {
    const result = await check(rule, {
      "new.md": page("id: BOK-2"),
      "other.md": page("id: BOK-3"),
      "old.md": page("id: BOK-1\nlifecycle: Retired\nreplaced_by: bok-2"),
      "split.md": page("id: BOK-4\nlifecycle: Retired\nreplaced_by: [BOK-2, BOK-3]"),
    });
    expect(result.findings).toEqual([]);
  });

  it("reports missing, unknown, self, and non-scalar references on pages in scope", async () => {
    const result = await check(rule, {
      "a.md": page("id: BOK-1\nlifecycle: Retired"),
      "b.md": page("id: BOK-2\nlifecycle: Retired\nreplaced_by: BOK-9"),
      "c.md": page("id: BOK-3\nlifecycle: Retired\nreplaced_by: BOK-3"),
      "d.md": page("id: BOK-4\nlifecycle: Retired\nreplaced_by: [BOK-1, { id: BOK-2 }]"),
      "e.md": page('id: BOK-5\nlifecycle: Retired\nreplaced_by: ""'),
    });
    expect(summary(result)).toEqual([
      "docs/a.md:1 reference-field/missing",
      "docs/b.md:4 reference-field/unknown",
      "docs/c.md:4 reference-field/self",
      "docs/d.md:4 reference-field/not-scalar",
      "docs/e.md:4 reference-field/missing",
    ]);
    expect(result.findings[1]?.message).toBe(
      'Value "BOK-9" of "replaced_by" matches the "id" of no page.',
    );
  });

  it("checks only pages in scope, and makes the field optional without required", async () => {
    const optional: CheckRule = { id: "refs", rule: "reference-field", field: "see", target: "id" };
    const result = await check(optional, {
      "a.md": page("id: A-1"),
      "b.md": page("id: B-1\nsee: A-1"),
      "c.md": page("id: C-1\nsee: Z-9"),
    });
    expect(summary(result)).toEqual(["docs/c.md:3 reference-field/unknown"]);
    const scoped = await check(rule, {
      "current.md": page("id: BOK-1\nlifecycle: Freigegeben\nreplaced_by: BOK-9"),
    });
    expect(scoped.findings).toEqual([]);
  });
});
