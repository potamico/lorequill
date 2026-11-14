import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { allCatalogs, createTranslator, selectLocale, type Locale } from "../../src/core/i18n";

const PLACEHOLDER = /\{(\w+)\}/g;

function placeholdersOf(text: string): string[] {
  return [...text.matchAll(PLACEHOLDER)].map((match) => match[1] ?? "").sort();
}

describe("message catalogs", () => {
  const catalogs = allCatalogs();
  const locales = Object.keys(catalogs) as Locale[];
  const keys = Object.keys(catalogs.en);

  it("provide the same keys in every locale", () => {
    for (const locale of locales) {
      expect(Object.keys(catalogs[locale]).sort(), locale).toEqual([...keys].sort());
    }
  });

  it("use the same placeholders in every locale", () => {
    for (const locale of locales) {
      for (const key of keys) {
        const catalog = catalogs[locale] as Record<string, string>;
        const english = catalogs.en as Record<string, string>;
        expect(placeholdersOf(catalog[key] ?? ""), `${locale} ${key}`).toEqual(
          placeholdersOf(english[key] ?? ""),
        );
      }
    }
  });

  it("have no empty messages", () => {
    for (const locale of locales) {
      for (const [key, text] of Object.entries(catalogs[locale])) {
        expect(text.trim(), `${locale} ${key}`).not.toBe("");
      }
    }
  });

  it("uses Swiss spelling without the letter ß in German", () => {
    for (const text of Object.values(catalogs["de-CH"])) {
      expect(text).not.toContain("ß");
    }
  });

  it("addresses the author informally (du) in German, also in the manifest", () => {
    // Formal address: a verb followed by "Sie" ("Prüfen Sie"), or a form of "Ihr" or "Ihnen".
    // "Sie" at the start of a sentence refers to a thing ("Sie gilt nicht als bestanden").
    const formal = /\b\p{L}+en Sie\b|\b(?:Ihr|Ihre|Ihren|Ihrem|Ihrer|Ihnen)\b/u;
    const manifest = JSON.parse(
      readFileSync(resolve(import.meta.dirname, "../../package.nls.de.json"), "utf8"),
    ) as Record<string, string>;
    for (const text of [...Object.values(catalogs["de-CH"]), ...Object.values(manifest)]) {
      expect(text).not.toMatch(formal);
    }
  });

  it("has a message for every key of the profile issue codes", () => {
    const issueKeys = keys.filter((key) => key.startsWith("profile.issue."));
    expect(issueKeys).toHaveLength(20);
  });

  it("uses English keys that are identifiers, not texts", () => {
    for (const key of keys) {
      expect(key).toMatch(/^[a-z]+(?:\.[A-Za-z0-9-]+)+$/);
    }
  });
});

describe("check context labels (AT 42)", () => {
  it("name the editing state for Check Pages and the staged state for the commit check", () => {
    const labels: Record<Locale, { editing: string; staged: string }> = {
      en: { editing: "Editing state", staged: "staged state" },
      "de-CH": { editing: "Bearbeitungsstand", staged: "gestagter Stand" },
    };
    for (const [locale, { editing, staged }] of Object.entries(labels) as [
      Locale,
      { editing: string; staged: string },
    ][]) {
      const catalog = allCatalogs()[locale] as Record<string, string>;
      for (const key of ["check.passed", "check.failed"]) {
        expect(catalog[key], `${locale} ${key}`).toContain(editing);
      }
      for (const key of ["commit.checking", "commit.checkFailed", "commit.findingsTitleStaged"]) {
        expect(catalog[key], `${locale} ${key}`).toContain(staged);
        expect(catalog[key], `${locale} ${key}`).not.toContain(editing);
      }
    }
  });
});

describe("selectLocale", () => {
  it.each([
    ["en", "en"],
    ["EN", "en"],
    ["en-US", "en"],
    ["en_GB", "en"],
    ["de-CH", "de-CH"],
    ["de-ch", "de-CH"],
    ["de_CH", "de-CH"],
    ["de", "de-CH"],
    ["de-DE", "de-CH"],
    ["fr", "en"],
    ["fr-CH", "en"],
    ["", "en"],
    [undefined, "en"],
  ])("maps %j to %j", (requested, expected) => {
    expect(selectLocale(requested)).toBe(expected);
  });
});

describe("createTranslator", () => {
  it("replaces placeholders", () => {
    const translate = createTranslator("en");
    expect(translate("pages.noMatch", { filter: "abc" })).toBe('No pages match "abc".');
    expect(translate("pages.filterActive", { filter: "x" })).toBe("Filter: x");
  });

  it("replaces numbers and keeps dollar signs in values literally", () => {
    const translate = createTranslator("en");
    expect(translate("pages.truncated", { limit: 5 })).toContain("first 5 files");
    expect(translate("pages.noMatch", { filter: "$& $1 $$" })).toBe('No pages match "$& $1 $$".');
  });

  it("leaves a placeholder without a value untouched", () => {
    expect(createTranslator("en")("pages.noMatch")).toBe('No pages match "{filter}".');
  });

  it("translates with the requested locale", () => {
    expect(createTranslator("de-CH")("pages.noMatch", { filter: "x" })).toBe(
      "Keine Seite passt zu «x».",
    );
    expect(createTranslator("de-CH")("action.openProfile")).toBe("Profil öffnen");
  });
});
