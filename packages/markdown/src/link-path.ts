import { posix } from "node:path";

// Characters that would end, break, or change the meaning of an inline link destination or a
// fragment. Non-ASCII letters stay readable; CommonMark and MkDocs accept them as they are.
// eslint-disable-next-line no-control-regex -- control characters must be percent-encoded.
const ENCODE = /[\u0000- \u007F"#%'()<>?[\\\]^`{|}]/gu;

/**
 * Builds the relative link destination from one page to another (specification §10, Insert
 * Link): a POSIX path relative to the source page's directory, with the target's `.md` extension
 * kept and unsafe characters percent-encoded. The optional fragment is appended after `#`.
 *
 * Both paths are POSIX paths relative to the content root, such as `guides/setup.md`.
 */
export function relativeLinkPath(
  sourcePath: string,
  targetPath: string,
  fragment?: string,
): string {
  const relativePath = posix.relative(posix.dirname(sourcePath), targetPath);
  const path = relativePath === "" ? posix.basename(targetPath) : relativePath;
  const encoded = path.split("/").map(encodeSegment).join("/");
  return fragment === undefined || fragment === ""
    ? encoded
    : `${encoded}#${encodeSegment(fragment)}`;
}

function encodeSegment(segment: string): string {
  return segment.replace(ENCODE, (character) =>
    [...new TextEncoder().encode(character)]
      .map((byte) => `%${byte.toString(16).toUpperCase().padStart(2, "0")}`)
      .join(""),
  );
}
