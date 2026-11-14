/** Why a link destination cannot be a valid target. */
export type InvalidDestinationReason =
  /** `[text]()` or `[text](<>)`. */
  | "empty"
  /** `/docs/page.md`, `//server/share`, or `C:\page.md`. */
  | "absolute-path"
  /** A scheme other than `http:`, `https:`, or `mailto:`, such as `file:` or `javascript:`. */
  | "unsupported-scheme"
  /** The path leaves the content root, for example `../../outside.md` from the root level. */
  | "outside-content-root"
  /** A backslash; repository links use POSIX separators. */
  | "backslash"
  /** Invalid percent-encoding, or a NUL character after decoding. */
  | "malformed-encoding";

export type LinkDestination =
  /** `http:`, `https:`, or `mailto:`. Never fetched. */
  | { readonly kind: "external"; readonly scheme: "http" | "https" | "mailto" }
  /** `#fragment`: an anchor in the same page. */
  | { readonly kind: "same-page"; readonly fragment: string }
  /** A path under the content root, POSIX-normalized, with an optional decoded fragment. */
  | { readonly kind: "path"; readonly path: string; readonly fragment?: string }
  | { readonly kind: "invalid"; readonly reason: InvalidDestinationReason };

const SCHEME = /^([A-Za-z][A-Za-z0-9+.-]*):/;
const EXTERNAL_SCHEMES = new Set(["http", "https", "mailto"]);

/**
 * Resolves a Markdown link destination against the page that contains it (specification §10).
 *
 * `sourcePath` is the page's POSIX path relative to the content root, such as
 * `guides/setup.md`. Paths are percent-decoded and normalized; `..` is valid while the result stays
 * inside the content root. A query (`?x=1`) is ignored. This function is purely lexical: whether
 * the target exists, is a regular file, or escapes the root through a symbolic link is decided by
 * a {@link LinkTargetProvider}.
 */
export function resolveLinkDestination(sourcePath: string, destination: string): LinkDestination {
  if (destination.trim() === "") {
    return invalid("empty");
  }
  const scheme = SCHEME.exec(destination)?.[1];
  if (scheme !== undefined) {
    if (scheme.length === 1 && /^[A-Za-z]:[\\/]/.test(destination)) {
      return invalid("absolute-path");
    }
    const lower = scheme.toLowerCase();
    return EXTERNAL_SCHEMES.has(lower)
      ? { kind: "external", scheme: lower as "http" | "https" | "mailto" }
      : invalid("unsupported-scheme");
  }

  const hash = destination.indexOf("#");
  const beforeHash = hash === -1 ? destination : destination.slice(0, hash);
  const rawFragment = hash === -1 ? undefined : destination.slice(hash + 1);
  const query = beforeHash.indexOf("?");
  const rawPath = query === -1 ? beforeHash : beforeHash.slice(0, query);

  const fragment = rawFragment === undefined ? undefined : decode(rawFragment);
  if (fragment === null) {
    return invalid("malformed-encoding");
  }
  if (rawPath === "") {
    return { kind: "same-page", fragment: fragment ?? "" };
  }
  if (rawPath.startsWith("/")) {
    return invalid("absolute-path");
  }
  if (rawPath.includes("\\")) {
    return invalid("backslash");
  }
  const decoded = decode(rawPath);
  if (decoded === null) {
    return invalid("malformed-encoding");
  }
  if (decoded.startsWith("/")) {
    return invalid("absolute-path");
  }
  if (decoded.includes("\\")) {
    return invalid("backslash");
  }

  const slash = sourcePath.lastIndexOf("/");
  const directory = slash === -1 ? "" : sourcePath.slice(0, slash);
  const path = normalizeRelative(`${directory}/${decoded}`);
  if (path === ".." || path.startsWith("../")) {
    return invalid("outside-content-root");
  }
  return fragment === undefined ? { kind: "path", path } : { kind: "path", path, fragment };
}

/**
 * Normalizes a relative POSIX path without a trailing slash, like `posix.normalize` followed by
 * removing the trailing separator: `.` segments and empty segments are dropped, `..` removes the
 * previous segment or stays at the start. Free of `node:path`, so the webview can use it.
 */
function normalizeRelative(path: string): string {
  const segments: string[] = [];
  for (const segment of path.split("/")) {
    if (segment === "" || segment === ".") {
      continue;
    }
    if (segment === ".." && segments.length > 0 && segments.at(-1) !== "..") {
      segments.pop();
    } else {
      segments.push(segment);
    }
  }
  return segments.length === 0 ? "." : segments.join("/");
}

function invalid(reason: InvalidDestinationReason): LinkDestination {
  return { kind: "invalid", reason };
}

/** Percent-decodes a string; `null` for invalid encoding or a decoded NUL character. */
function decode(value: string): string | null {
  try {
    const decoded = decodeURIComponent(value);
    return decoded.includes("\0") ? null : decoded;
  } catch {
    return null;
  }
}

/** What exists at a path under the content root. */
export type TargetKind =
  | "file"
  | "directory"
  | "missing"
  /** A symbolic link (or a path through one) that resolves outside the content root. */
  | "outside"
  /** A device, socket, FIFO, or another special file. */
  | "unsupported";

/**
 * Read-only access to the files under one content root, used to verify link targets. The check
 * engine provides snapshot-backed implementations; {@link createFileSystemTargetProvider} reads
 * the filesystem.
 */
export interface LinkTargetProvider {
  /** Describes the POSIX path relative to the content root (`.` is the root itself). */
  describe(path: string): Promise<TargetKind>;
  /** Reads a Markdown target as text, for anchor validation; `undefined` if it cannot be read. */
  readText(path: string): Promise<string | undefined>;
}
