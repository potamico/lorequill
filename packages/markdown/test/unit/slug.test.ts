import { describe, expect, it } from "vitest";
import {
  EMPTY_SLUG_FALLBACK,
  MAX_SLUG_LENGTH,
  proposeFilename,
  slugifyTitle,
} from "../../src/index";

describe("slugifyTitle: examples from the specification", () => {
  it.each([
    ["Identität", "identitaet"],
    ["Metadata Schema", "metadata-schema"],
    ["Claim!", "claim"],
  ])("turns %j into %j", (title, expected) => {
    expect(slugifyTitle(title)).toBe(expected);
  });
});

describe("slugifyTitle: transliteration and case", () => {
  it.each([
    ["ä", "ae"],
    ["ö", "oe"],
    ["ü", "ue"],
    ["ß", "ss"],
    ["Ä", "ae"],
    ["Ö", "oe"],
    ["Ü", "ue"],
    ["ẞ", "ss"],
    ["Größe", "groesse"],
    ["ÜBER GRÖSSE", "ueber-groesse"],
    ["Schlüssel für Äpfel", "schluessel-fuer-aepfel"],
  ])("turns %j into %j", (title, expected) => {
    expect(slugifyTitle(title)).toBe(expected);
  });

  it("treats decomposed and composed umlauts alike", () => {
    const composed = "Identit\u00e4t";
    const decomposed = "Identita\u0308t";
    expect(decomposed).not.toBe(composed);
    expect(slugifyTitle(decomposed)).toBe("identitaet");
    expect(slugifyTitle(decomposed)).toBe(slugifyTitle(composed));
  });

  it.each([
    ["Café", "cafe"],
    ["Crème brûlée", "creme-brulee"],
    ["Señor", "senor"],
    ["Ça va", "ca-va"],
    ["İstanbul", "istanbul"],
  ])("removes Latin diacritics from %j", (title, expected) => {
    expect(slugifyTitle(title)).toBe(expected);
  });

  it("keeps letters of other scripts and digits", () => {
    expect(slugifyTitle("日本語 テスト")).toBe("日本語-テスト");
    expect(slugifyTitle("Привет Мир")).toBe("привет-мир");
    expect(slugifyTitle("Version 2024")).toBe("version-2024");
    // Combining vowel signs and the virama must survive.
    expect(slugifyTitle("हिन्दी भाषा")).toBe("हिन्दी-भाषा");
    expect(slugifyTitle("ภาษาไทย")).toBe("ภาษาไทย");
  });

  it("falls back when only combining marks remain", () => {
    expect(slugifyTitle("\u20d0\u20d1")).toBe(EMPTY_SLUG_FALLBACK);
  });

  it("lowercases ASCII", () => {
    expect(slugifyTitle("MiXeD CaSe")).toBe("mixed-case");
  });
});

describe("slugifyTitle: separators and punctuation", () => {
  it.each([
    ["spaces", "a b c", "a-b-c"],
    ["tabs and non-breaking spaces", "a\tb\u00a0c", "a-b-c"],
    ["newlines", "a\nb", "a-b"],
    ["repeated spaces", "a    b", "a-b"],
    ["repeated hyphens", "a---b", "a-b"],
    ["a hyphen between spaces", "a - b", "a-b"],
    ["leading and trailing hyphens", "--a--", "a"],
    ["leading and trailing spaces", "  a  ", "a"],
    ["punctuation", "Hello, World! (Part 1): 'x'", "hello-world-part-1-x"],
    ["dots", "Version 2.0", "version-20"],
    ["underscores", "snake_case name", "snakecase-name"],
    ["slashes and backslashes", "a/b\\c", "abc"],
    ["emoji", "Rocket 🚀 launch", "rocket-launch"],
    ["an em dash between spaces", "A — B", "a-b"],
  ])("handles %s", (_name, title, expected) => {
    expect(slugifyTitle(title)).toBe(expected);
  });

  it("only produces letters, digits, and single inner hyphens", () => {
    const samples = ["a", "A b", "x--y", "--", "Ünï cödé!!", "a_b.c", "日本 語", "1 2 3", "ß ß"];
    for (const sample of samples) {
      expect(slugifyTitle(sample), sample).toMatch(/^[\p{L}\p{M}\p{N}]+(?:-[\p{L}\p{M}\p{N}]+)*$/u);
    }
  });
});

describe("slugifyTitle: empty results, reserved names, and length", () => {
  it.each(["", "   ", "!!!", "---", "...", "🚀", "()[]{}"])(
    "turns %j into the fallback",
    (title) => {
      expect(slugifyTitle(title)).toBe(EMPTY_SLUG_FALLBACK);
    },
  );

  it.each([
    ["con", "con-page"],
    ["CON", "con-page"],
    ["Aux!", "aux-page"],
    ["NUL", "nul-page"],
    ["prn", "prn-page"],
    ["COM1", "com1-page"],
    ["lpt9", "lpt9-page"],
    ["COM0", "com0-page"],
  ])("renames the reserved name %j to %j", (title, expected) => {
    expect(slugifyTitle(title)).toBe(expected);
  });

  it("does not rename names that merely contain a reserved name", () => {
    expect(slugifyTitle("console")).toBe("console");
    expect(slugifyTitle("con tent")).toBe("con-tent");
    expect(slugifyTitle("com10")).toBe("com10");
  });

  it("cuts long titles and never ends with a hyphen", () => {
    const slug = slugifyTitle("word ".repeat(100));
    expect(slug.length).toBeLessThanOrEqual(MAX_SLUG_LENGTH);
    expect(slug.endsWith("-")).toBe(false);
    expect(slug.startsWith("word-word")).toBe(true);
  });

  it("cuts at a boundary that would leave a trailing hyphen", () => {
    const title = `${"a".repeat(MAX_SLUG_LENGTH - 1)} ${"b".repeat(10)}`;
    expect(slugifyTitle(title)).toBe("a".repeat(MAX_SLUG_LENGTH - 1));
  });

  it("never cuts inside a code point", () => {
    const slug = slugifyTitle("𠀀".repeat(MAX_SLUG_LENGTH + 20));
    expect(Array.from(slug)).toHaveLength(MAX_SLUG_LENGTH);
    expect(slug).toBe("𠀀".repeat(MAX_SLUG_LENGTH));
  });

  it("is not confused by a reserved name that appears only after cutting", () => {
    expect(slugifyTitle(`con${"-".repeat(200)}`)).toBe("con-page");
  });
});

describe("slugifyTitle: determinism", () => {
  const samples = [
    "Identität",
    "Metadata Schema",
    "Claim!",
    "",
    "!!!",
    "con",
    "Größe",
    "日本語",
    "a - b",
    "x".repeat(300),
    "Ünï cödé",
    "Café Crème",
    "A — B",
    "𠀀𠀀",
    "   ",
    "snake_case",
    "Version 2.0",
  ];

  it("returns the same result for the same input", () => {
    for (const sample of samples) {
      expect(slugifyTitle(sample)).toBe(slugifyTitle(sample));
    }
  });

  it("is idempotent: slugifying a slug returns it unchanged", () => {
    for (const sample of samples) {
      const slug = slugifyTitle(sample);
      expect(slugifyTitle(slug), sample).toBe(slug);
    }
  });
});

describe("proposeFilename", () => {
  it("appends .md to the slug", () => {
    expect(proposeFilename("Metadata Schema", [])).toBe("metadata-schema.md");
  });

  it("returns the plain name when other names exist", () => {
    expect(proposeFilename("Claim!", ["other.md", "claims.md"])).toBe("claim.md");
  });

  it("adds the first free numeric suffix on a collision", () => {
    expect(proposeFilename("Claim", ["claim.md"])).toBe("claim-2.md");
    expect(proposeFilename("Claim", ["claim.md", "claim-2.md"])).toBe("claim-3.md");
    expect(proposeFilename("Claim", ["claim.md", "claim-3.md"])).toBe("claim-2.md");
  });

  it("compares names case-insensitively", () => {
    expect(proposeFilename("Claim", ["CLAIM.md"])).toBe("claim-2.md");
    expect(proposeFilename("Claim", ["Claim-2.MD", "claim.md"])).toBe("claim-3.md");
  });

  it("compares names independent of Unicode normalization", () => {
    expect(proposeFilename("Größe", ["groe\u00dfe.md"])).toBe("groesse.md");
    expect(proposeFilename("日本語", ["日本語.md".normalize("NFD")])).toBe("日本語-2.md");
  });

  it("does not depend on the order of the existing names", () => {
    const names = ["claim.md", "claim-2.md", "claim-4.md", "other.md"];
    const expected = proposeFilename("Claim", names);
    expect(proposeFilename("Claim", [...names].reverse())).toBe(expected);
    expect(proposeFilename("Claim", new Set(names))).toBe(expected);
    expect(expected).toBe("claim-3.md");
  });

  it("proposes a usable name for empty and reserved titles", () => {
    expect(proposeFilename("", [])).toBe("untitled.md");
    expect(proposeFilename("", ["untitled.md"])).toBe("untitled-2.md");
    expect(proposeFilename("CON", [])).toBe("con-page.md");
  });

  it("accepts any iterable of names", () => {
    function* names(): Generator<string> {
      yield "claim.md";
    }
    expect(proposeFilename("Claim", names())).toBe("claim-2.md");
  });
});
