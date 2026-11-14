import type { Profile } from "@lorequill/profile";

export type StableLinkResult =
  | { readonly kind: "link"; readonly url: string }
  /** The profile has no `site.url` or no `site.stable_links`. */
  | { readonly kind: "not-configured" }
  /** The page has no usable value in the stable-link field. */
  | { readonly kind: "no-value"; readonly field: string };

/**
 * The stable address of a page (`site.url` + `site.stable_links.path` with `{value}` replaced by
 * the page's field value, encoded like `encodeURIComponent`), as the MkDocs hook in
 * docs/examples/mkdocs writes it. `value` is the front matter value of the field, if any.
 */
export function stableLink(profile: Profile, value: unknown): StableLinkResult {
  const url = profile.site?.url;
  const links = profile.site?.stable_links;
  if (url === undefined || links === undefined) {
    return { kind: "not-configured" };
  }
  const text =
    typeof value === "string" || (typeof value === "number" && Number.isFinite(value))
      ? String(value).trim()
      : "";
  // The same values the hook skips: they cannot be a single path segment.
  // eslint-disable-next-line no-control-regex -- control characters are rejected on purpose.
  if (text === "" || text === "." || text === ".." || /[/\\\u0000-\u001f\u007f]/.test(text)) {
    return { kind: "no-value", field: links.field };
  }
  return { kind: "link", url: `${url}${links.path.replace("{value}", encodeURIComponent(text))}` };
}
