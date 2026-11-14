import type { Collection } from "@lorequill/profile";

/**
 * The domain of a page: the first path segment under the content root (specification §6).
 * Pages directly in the content root have no domain.
 */
export function domainOf(pagePath: string): string | undefined {
  const slash = pagePath.indexOf("/");
  return slash > 0 ? pagePath.slice(0, slash) : undefined;
}

/** The directory of a page relative to the content root; empty for the content root itself. */
function directoryOf(pagePath: string): string {
  const slash = pagePath.lastIndexOf("/");
  return slash === -1 ? "" : pagePath.slice(0, slash);
}

/**
 * Whether a collection's `folder` is exactly the page's directory, after replacing the whole
 * segment `{domain}` by the page's domain. No other expansion and no prefix matching take place.
 */
export function folderMatches(folder: string, pagePath: string): boolean {
  const domain = domainOf(pagePath);
  const segments = folder.split("/");
  if (domain === undefined && segments.includes("{domain}")) {
    return false;
  }
  const expanded = segments.map((segment) => (segment === "{domain}" ? domain : segment));
  return expanded.join("/") === directoryOf(pagePath);
}

/** A scalar front matter value as text, for comparing with a collection's `match.equals`. */
function scalarText(value: unknown): string | undefined {
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean"
    ? String(value)
    : undefined;
}

/**
 * The collections an existing page belongs to: its directory matches the collection folder, and
 * the `match` field, if the collection has one, has the required value. Several results mean the
 * profile is ambiguous for this page.
 */
export function matchingCollections(
  collections: readonly Collection[],
  pagePath: string,
  data: Readonly<Record<string, unknown>>,
): Collection[] {
  return collections.filter(
    (collection) =>
      folderMatches(collection.folder, pagePath) &&
      (collection.match === undefined ||
        scalarText(data[collection.match.field]) === collection.match.equals),
  );
}

/** Replaces `{domain}` in a default value by the page's domain (empty without one). */
export function expandDefault(value: string, pagePath: string): string {
  return value.replaceAll("{domain}", domainOf(pagePath) ?? "");
}
