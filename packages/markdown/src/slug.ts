/** Maximum length of a generated slug, in characters. */
export const MAX_SLUG_LENGTH = 80;

/** Slug used when a title yields nothing usable, for example `!!!`. */
export const EMPTY_SLUG_FALLBACK = "untitled";

/** Suffix that keeps a reserved device name usable as a file name on all platforms. */
const RESERVED_NAME_SUFFIX = "-page";

const GERMAN_TRANSLITERATION: Readonly<Record<string, string>> = {
  ä: "ae",
  ö: "oe",
  ü: "ue",
  ß: "ss",
  Ä: "ae",
  Ö: "oe",
  Ü: "ue",
  ẞ: "ss",
};

// File names that Windows reserves as device names, with or without an extension.
const RESERVED_NAMES = new Set([
  "con",
  "prn",
  "aux",
  "nul",
  ...Array.from({ length: 10 }, (_, index) => `com${String(index)}`),
  ...Array.from({ length: 10 }, (_, index) => `lpt${String(index)}`),
]);

/**
 * Derives a file name stem from a page title (specification section 10).
 *
 * 1. Normalize to NFC, then `ä→ae`, `ö→oe`, `ü→ue`, `ß→ss` (also for capitals).
 * 2. Lowercase, then drop Latin diacritics (`é→e`) by decomposing and removing combining marks
 *    in U+0300 to U+036F. Letters of other scripts are kept.
 * 3. Whitespace becomes a hyphen. Everything except letters, combining marks of non-Latin
 *    scripts, digits, and hyphens is removed, including dots and underscores.
 * 4. Repeated hyphens collapse, and leading and trailing hyphens are removed.
 * 5. The result is cut to {@link MAX_SLUG_LENGTH} characters (never inside a code point).
 * 6. A reserved device name such as `con` gets the suffix `-page`.
 * 7. An empty result becomes {@link EMPTY_SLUG_FALLBACK}.
 *
 * The function is deterministic and idempotent: slugifying a slug returns it unchanged.
 */
export function slugifyTitle(title: string): string {
  let slug = title
    .normalize("NFC")
    .replace(/[äöüßÄÖÜẞ]/gu, (letter) => GERMAN_TRANSLITERATION[letter] ?? letter)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .normalize("NFC")
    .replace(/\s+/gu, "-")
    // Combining marks (\p{M}) stay: scripts such as Devanagari or Thai need them to spell words.
    .replace(/[^\p{L}\p{M}\p{N}-]/gu, "")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "");

  slug = Array.from(slug).slice(0, MAX_SLUG_LENGTH).join("").replace(/-+$/g, "");

  // A title made only of marks has no usable letters or digits.
  if (!/[\p{L}\p{N}]/u.test(slug)) {
    return EMPTY_SLUG_FALLBACK;
  }
  return RESERVED_NAMES.has(slug) ? `${slug}${RESERVED_NAME_SUFFIX}` : slug;
}

/** Key used to compare file names: case-insensitive and normalization-insensitive. */
function comparisonKey(fileName: string): string {
  return fileName.normalize("NFC").toLowerCase();
}

/**
 * Proposes a file name for a new page: the slug of the title plus `.md`, or the first free name
 * `<slug>-2.md`, `<slug>-3.md`, ... when the name is taken.
 *
 * Names are compared case-insensitively, so a proposal never collides on case-insensitive file
 * systems either. The result does not depend on the order of `existingFileNames`. The author can
 * always edit the proposal; the creation flow still rejects collisions.
 *
 * @param existingFileNames File names (not paths) in the target directory, including the extension.
 */
export function proposeFilename(title: string, existingFileNames: Iterable<string>): string {
  const taken = new Set(Array.from(existingFileNames, comparisonKey));
  const slug = slugifyTitle(title);

  let candidate = `${slug}.md`;
  for (let counter = 2; taken.has(comparisonKey(candidate)); counter++) {
    candidate = `${slug}-${String(counter)}.md`;
  }
  return candidate;
}
