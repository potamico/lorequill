import { bodyStart } from "./front-matter";
import { readLine } from "./lines";
import { readFrontMatter } from "./read";

export interface Heading {
  readonly text: string;
  /** Heading level, 1 to 6. */
  readonly level: number;
}

const ATX_HEADING = /^ {0,3}(#{1,6})(?:[ \t]+(.*))?$/;
const SETEXT_UNDERLINE = /^ {0,3}(?:=+|-{2,})[ \t]*$/;
const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})(.*)$/;
const LIST_ITEM = /^ {0,3}(?:[-*+]|\d{1,9}[.)])(?:[ \t]|$)/;
// A trailing attribute list such as `{#custom-id}` or `{ .class }`.
const ATTRIBUTE_LIST = /\s*\{\s*[#.:][^}]*\}\s*$/;
const CLOSING_HASHES = /[ \t]+#+[ \t]*$/;

/**
 * Finds the first Markdown heading at or after `from`: an ATX heading (`# Title`) or a setext
 * heading (a line underlined with `===` or `---`). Headings inside fenced code blocks are ignored.
 *
 * The returned text is the raw heading text without closing `#` characters and without a trailing
 * attribute list. Inline formatting is not interpreted. For a multi-line setext heading, the last
 * line is used. Headings without any text are skipped.
 */
export function findFirstHeading(text: string, from = 0): Heading | undefined {
  let position = from;
  let fence: { char: string; length: number } | undefined;
  let paragraphLine: string | undefined;

  while (position < text.length) {
    const line = readLine(text, position);
    position = line.next;
    const content = line.content;

    if (fence) {
      const closing = /^ {0,3}(`{3,}|~{3,})[ \t]*$/.exec(content)?.[1];
      if (closing?.startsWith(fence.char) && closing.length >= fence.length) {
        fence = undefined;
      }
      continue;
    }

    const opening = FENCE_OPEN.exec(content);
    if (opening?.[1] && !(opening[1].startsWith("`") && opening[2]?.includes("`"))) {
      fence = { char: opening[1].charAt(0), length: opening[1].length };
      paragraphLine = undefined;
      continue;
    }

    const atx = ATX_HEADING.exec(content);
    if (atx?.[1]) {
      const heading = cleanHeadingText(atx[2] ?? "", true);
      if (heading !== "") {
        return { text: heading, level: atx[1].length };
      }
      paragraphLine = undefined;
      continue;
    }

    if (paragraphLine !== undefined && SETEXT_UNDERLINE.test(content)) {
      const heading = cleanHeadingText(paragraphLine, false);
      if (heading !== "") {
        return { text: heading, level: content.trimStart().startsWith("=") ? 1 : 2 };
      }
    }

    paragraphLine = isParagraphLine(content) ? content : undefined;
  }
  return undefined;
}

function isParagraphLine(content: string): boolean {
  return (
    content.trim() !== "" &&
    /^ {0,3}\S/.test(content) &&
    !content.trimStart().startsWith(">") &&
    !LIST_ITEM.test(content)
  );
}

function cleanHeadingText(raw: string, atx: boolean): string {
  let heading = raw.trim();
  if (atx) {
    heading = heading.replace(CLOSING_HASHES, "");
  }
  return heading.replace(ATTRIBUTE_LIST, "").trim();
}

export type TitleSource = "front-matter" | "heading" | "filename";

export interface PageMetadata {
  /** The label of the page: front matter title, else first heading, else the file name. */
  readonly title: string;
  readonly titleSource: TitleSource;
  /** Non-empty string entries of the front matter `aliases` list. */
  readonly aliases: readonly string[];
  /** Whether the front matter could be read; `invalid` means the properties panel is read-only. */
  readonly frontMatter: "none" | "ok" | "invalid";
}

/**
 * Reads what the Pages tree and link search need from a page: its label and its aliases.
 *
 * The label comes from a non-empty string front matter `title`, otherwise from the first heading
 * of the body, otherwise it is `fileName` exactly as given. A front matter that cannot be read
 * does not prevent the heading or file name from being used.
 */
export function readPageMetadata(text: string, fileName: string): PageMetadata {
  const frontMatter = readFrontMatter(text);
  const data = frontMatter.status === "ok" ? frontMatter.data : undefined;

  const aliases = Array.isArray(data?.aliases)
    ? (data.aliases as unknown[])
        .filter((alias): alias is string => typeof alias === "string")
        .map((alias) => alias.trim())
        .filter((alias) => alias !== "")
    : [];

  const frontMatterTitle = typeof data?.title === "string" ? data.title.trim() : "";
  if (frontMatterTitle !== "") {
    return { title: frontMatterTitle, titleSource: "front-matter", aliases, frontMatter: "ok" };
  }

  const status = frontMatter.status;
  const heading = findFirstHeading(text, bodyStart(text));
  if (heading) {
    return { title: heading.text, titleSource: "heading", aliases, frontMatter: status };
  }
  return { title: fileName, titleSource: "filename", aliases, frontMatter: status };
}
