import { MESSAGES } from "@lorequill/checks";
import { describe, expect, it } from "vitest";
import { findingMessageKey, localizeFinding } from "../../src/core/findings";
import { allCatalogs, createTranslator } from "../../src/core/i18n";

const placeholders = (text: string): string[] =>
  [...text.matchAll(/\{(\w+)\}/g)].map(([, name]) => name ?? "").sort();

describe("finding messages", () => {
  it("exist in every catalog for every engine finding code, with the engine's placeholders", () => {
    for (const [code, english] of Object.entries(MESSAGES)) {
      const key = findingMessageKey(code);
      for (const [locale, catalog] of Object.entries(allCatalogs())) {
        const text = (catalog as Record<string, string | undefined>)[key];
        expect(text, `${locale} ${key}`).toBeDefined();
        expect(placeholders(text ?? ""), `${locale} ${key}`).toEqual(placeholders(english));
      }
    }
  });

  it("localizes a finding and keeps the server message for unknown codes", () => {
    const german = createTranslator("de-CH");
    expect(
      localizeFinding(german, "relative-links/missing-target", { target: "docs/a.md" }, "fallback"),
    ).toBe("Das Linkziel «docs/a.md» existiert nicht.");
    expect(localizeFinding(german, "future/rule", {}, "English text")).toBe("English text");
  });
});
