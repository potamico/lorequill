/** Longest suggested branch name; authors may type longer ones. */
const MAX_SUGGESTION = 50;

/**
 * Branch names that Git accepts and that cannot be mistaken for command-line options, like
 * `branchName` of the profile schema.
 */
const BRANCH_NAME =
  // Control characters are rejected on purpose, like Git does for ref names.
  // eslint-disable-next-line no-control-regex
  /^(?!-)(?!\/)(?!@$)(?!.*\.\.)(?!.*\/\/)(?!.*@\{)(?!.*\.lock(?:\/|$))(?!.*(?:^|\/)\.)(?!.*[/.]$)[^\s~^:?*[\\\x00-\x1f\x7f]+$/;

export function isValidBranchName(name: string): boolean {
  return name.length <= 255 && BRANCH_NAME.test(name);
}

const UMLAUTS: Readonly<Record<string, string>> = {
  ä: "ae",
  ö: "oe",
  ü: "ue",
  Ä: "Ae",
  Ö: "Oe",
  Ü: "Ue",
  ß: "ss",
};

/**
 * A branch name made from a commit subject: lowercase ASCII words joined by hyphens, without a
 * conventional-commit type such as `docs:`. `undefined` when nothing usable remains.
 */
export function branchNameFrom(subject: string): string | undefined {
  const words = subject
    .replace(/^[a-z]+(?:\([^)]*\))?!?:\s*/i, "")
    .replace(/[äöüÄÖÜß]/g, (character) => UMLAUTS[character] ?? character)
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word !== "");
  let name = "";
  for (const word of words) {
    const next = name === "" ? word : `${name}-${word}`;
    if (next.length > MAX_SUGGESTION) {
      break;
    }
    name = next;
  }
  if (name === "") {
    name = words[0]?.slice(0, MAX_SUGGESTION) ?? "";
  }
  return name === "" ? undefined : name;
}
