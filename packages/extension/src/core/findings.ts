import type { MessageKey, MessageParams, Translate } from "./i18n";
import { allCatalogs } from "./i18n";

/** Catalog key of a finding code: `relative-links/missing-target` → `finding.relative-links.missing-target`. */
export function findingMessageKey(code: string): string {
  return `finding.${code.replace("/", ".")}`;
}

function isMessageKey(key: string): key is MessageKey {
  return Object.hasOwn(allCatalogs().en, key);
}

/**
 * The message of a finding in the display language. The language server sends English messages
 * plus the finding code and parameters; unknown codes (for example from a newer engine) keep the
 * English message.
 */
export function localizeFinding(
  translate: Translate,
  code: string,
  params: MessageParams,
  fallback: string,
): string {
  const key = findingMessageKey(code);
  return isMessageKey(key) ? translate(key, params) : fallback;
}
