import { extractLinks, resolveLinkDestination } from "@lorequill/markdown";
import type { RelativeLinksRule } from "@lorequill/profile";
import type { RuleContext } from "../context";
import type { FindingCode } from "../findings";

/** Defaults of decision D11. */
export const RELATIVE_LINKS_DEFAULTS = { anchors: true, slugify: "ascii" } as const;

const MARKDOWN_EXTENSION = /\.(?:md|markdown)$/i;

const TARGET_CODES: Readonly<Record<string, FindingCode>> = {
  missing: "relative-links/missing-target",
  directory: "relative-links/target-is-directory",
  outside: "relative-links/target-outside-content-root",
  unsupported: "relative-links/unsupported-target",
};

/**
 * `relative-links` (specification §10 and §11): every link destination of an included page must
 * be external (`http:`, `https:`, `mailto:`, never fetched) or a relative path to a regular file
 * inside the content root. With `anchors`, a fragment must name an anchor of the target page.
 * A page that is not a draft must not link to a draft (`content.drafts`), which is not published.
 */
export async function checkRelativeLinks(
  rule: RelativeLinksRule,
  context: RuleContext,
): Promise<void> {
  const anchors = rule.anchors ?? RELATIVE_LINKS_DEFAULTS.anchors;
  const slugify = rule.slugify ?? RELATIVE_LINKS_DEFAULTS.slugify;

  for (const page of context.pages) {
    await context.checkpoint();
    const published = !context.isDraft(page.path);
    for (const link of extractLinks(page.document())) {
      const at = {
        path: page.path,
        line: link.start.line,
        column: link.start.column,
        endLine: link.end.line,
        endColumn: link.end.column,
      };
      const resolved = resolveLinkDestination(page.path, link.destination);

      if (resolved.kind === "external") {
        continue;
      }
      if (resolved.kind === "invalid") {
        context.report({
          ...at,
          code: `relative-links/${resolved.reason}`,
          params: { destination: link.destination },
        });
        continue;
      }
      if (resolved.kind === "same-page") {
        if (anchors && resolved.fragment !== "") {
          const own = await context.anchorsOf(page.path, slugify);
          if (own && !own.has(resolved.fragment)) {
            context.report({
              ...at,
              code: "relative-links/missing-anchor",
              params: { anchor: resolved.fragment, target: context.repositoryPath(page.path) },
            });
          }
        }
        continue;
      }

      const target = context.repositoryPath(resolved.path);
      const kind = await context.snapshot.describe(resolved.path);
      const code = TARGET_CODES[kind];
      if (code) {
        context.report({ ...at, code, params: { target } });
        continue;
      }
      if (published && context.isDraft(resolved.path)) {
        context.report({ ...at, code: "relative-links/target-is-draft", params: { target } });
        continue;
      }
      if (
        anchors &&
        resolved.fragment !== undefined &&
        resolved.fragment !== "" &&
        MARKDOWN_EXTENSION.test(resolved.path)
      ) {
        const targetAnchors = await context.anchorsOf(resolved.path, slugify);
        if (targetAnchors && !targetAnchors.has(resolved.fragment)) {
          context.report({
            ...at,
            code: "relative-links/missing-anchor",
            params: { anchor: resolved.fragment, target },
          });
        }
      }
    }
  }
}
