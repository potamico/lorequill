import {
  collectAnchors,
  parseMarkdown,
  type AnchorSlugify,
  type MarkdownDocument,
} from "@lorequill/markdown";
import type { FindingCode, FindingParams } from "./findings";
import type { ContentSnapshot } from "./snapshot";

/** An included page, read once per run. */
export interface Page {
  /** POSIX path relative to the content root. */
  readonly path: string;
  readonly text: string;
  /** The parsed document; parsed on first use and shared by all rules. */
  document(): MarkdownDocument;
}

export interface FindingInput {
  readonly code: FindingCode;
  readonly params: FindingParams;
  /** POSIX path relative to the content root. */
  readonly path: string;
  readonly line: number;
  readonly column?: number;
  readonly endLine?: number;
  readonly endColumn?: number;
}

/** What a rule gets from the engine. */
export interface RuleContext {
  /** Included pages, sorted by path. */
  readonly pages: readonly Page[];
  readonly snapshot: ContentSnapshot;
  report(finding: FindingInput): void;
  /** Whether a content-root path is a draft (`content.drafts`): checked, but not published. */
  isDraft(path: string): boolean;
  /** Converts a content-root path to a repository path for messages. */
  repositoryPath(path: string): string;
  /** Anchors of a Markdown file; `undefined` if it cannot be read. Cached per run. */
  anchorsOf(path: string, slugify: AnchorSlugify): Promise<ReadonlySet<string> | undefined>;
  /** Throws if the run was cancelled or timed out, and lets timers run. */
  checkpoint(): Promise<void>;
}

export function createPage(path: string, text: string): Page {
  let document: MarkdownDocument | undefined;
  return {
    path,
    text,
    document: () => (document ??= parseMarkdown(text)),
  };
}

export function createAnchorCache(
  pages: readonly Page[],
  snapshot: ContentSnapshot,
): RuleContext["anchorsOf"] {
  const byPath = new Map(pages.map((page) => [page.path, page]));
  const cache = new Map<string, Promise<ReadonlySet<string> | undefined>>();
  return (path, slugify) => {
    const key = `${slugify}\u0000${path}`;
    let anchors = cache.get(key);
    if (!anchors) {
      const page = byPath.get(path);
      anchors = page
        ? Promise.resolve(collectAnchors(page.document(), slugify))
        : snapshot
            .readText(path)
            .then((text) =>
              text === undefined ? undefined : collectAnchors(parseMarkdown(text), slugify),
            );
      cache.set(key, anchors);
    }
    return anchors;
  };
}
