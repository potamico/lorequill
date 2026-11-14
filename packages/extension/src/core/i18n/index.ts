import { deCH } from "./de-ch";
import { en, type Catalog, type MessageKey } from "./en";

export type { Catalog, MessageKey } from "./en";

/** Locales with a message catalog. */
export type Locale = "en" | "de-CH";

export const DEFAULT_LOCALE: Locale = "en";

const CATALOGS: Readonly<Record<Locale, Catalog>> = { en, "de-CH": deCH };

export type MessageParams = Readonly<Record<string, string | number>>;

/** Returns the message of `key` with `{name}` placeholders replaced by `params`. */
export type Translate = (key: MessageKey, params?: MessageParams) => string;

/**
 * Chooses a catalog for a requested locale such as the `locale` of a profile or the VS Code
 * display language. An exact match wins (ignoring case); otherwise the language part decides
 * (`de` and `de-DE` use the only German catalog, `de-CH`); everything else uses English.
 */
export function selectLocale(requested: string | undefined): Locale {
  if (requested === undefined) {
    return DEFAULT_LOCALE;
  }
  const wanted = requested.toLowerCase().replaceAll("_", "-");
  const exact = (Object.keys(CATALOGS) as Locale[]).find(
    (locale) => locale.toLowerCase() === wanted,
  );
  if (exact) {
    return exact;
  }
  const language = wanted.split("-")[0];
  return (
    (Object.keys(CATALOGS) as Locale[]).find(
      (locale) => locale.toLowerCase().split("-")[0] === language,
    ) ?? DEFAULT_LOCALE
  );
}

export function createTranslator(locale: Locale): Translate {
  const catalog = CATALOGS[locale];
  return (key, params) =>
    catalog[key].replace(/\{(\w+)\}/g, (placeholder, name: string) => {
      const value = params?.[name];
      return value === undefined ? placeholder : String(value);
    });
}

/** All catalogs, for tests that check them against each other. */
export function allCatalogs(): Readonly<Record<Locale, Catalog>> {
  return CATALOGS;
}
