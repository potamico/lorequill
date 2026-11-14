import { LineCounter, isAlias, isNode, parseDocument, visit, type Document } from "yaml";
import type { FrontMatterIssue } from "./issues";

export interface SafeYaml {
  readonly document: Document.Parsed;
  /** Empty when the YAML was parsed safely and contains only supported constructs. */
  readonly issues: readonly FrontMatterIssue[];
}

/**
 * Parses YAML as data for document-level reading and editing.
 *
 * Only the YAML 1.2 core schema is used. Duplicate keys, multiple documents, merge keys, anchors,
 * aliases, and every explicit tag are reported instead of being interpreted, so nothing is ever
 * evaluated and ambiguous input is never rewritten silently.
 *
 * @param source The YAML text.
 * @param firstLine The 1-based line of `source` within the complete file, for issue locations.
 */
export function parseSafeYaml(source: string, firstLine: number): SafeYaml {
  const lineCounter = new LineCounter();
  const document = parseDocument(source, {
    lineCounter,
    version: "1.2",
    schema: "core",
    uniqueKeys: true,
    merge: false,
    prettyErrors: false,
  });

  const locate = (offset: number | undefined): { line?: number; column?: number } => {
    if (offset === undefined) {
      return {};
    }
    const { line, col } = lineCounter.linePos(offset);
    return { line: firstLine + line - 1, column: col };
  };

  const issues: FrontMatterIssue[] = [];

  for (const error of document.errors) {
    issues.push({
      code: error.code === "DUPLICATE_KEY" ? "yaml-duplicate-key" : "yaml-syntax",
      ...locate(error.pos[0]),
      params: { yamlCode: error.code },
    });
  }

  for (const warning of document.warnings) {
    // Unresolved tags are reported by the visitor below together with resolved ones.
    if (warning.code !== "TAG_RESOLVE_FAILED") {
      issues.push({
        code: "yaml-unsupported-construct",
        ...locate(warning.pos[0]),
        params: { construct: warning.code },
      });
    }
  }

  // The core schema still resolves explicit tags such as !!binary, !!set, and !!timestamp to
  // non-plain values. Anchors and aliases enable expansion attacks and are not needed for
  // front matter, so all of them are rejected.
  visit(document, (_key, node) => {
    const construct = unsupportedConstruct(node);
    if (construct !== undefined && isNode(node)) {
      issues.push({
        code: "yaml-unsupported-construct",
        ...locate(node.range?.[0]),
        params: { construct },
      });
    }
  });

  return { document, issues };
}

function unsupportedConstruct(node: unknown): "alias" | "anchor" | "tag" | undefined {
  if (isAlias(node)) {
    return "alias";
  }
  if (isNode(node)) {
    if (node.anchor !== undefined) {
      return "anchor";
    }
    if (node.tag !== undefined) {
      return "tag";
    }
  }
  return undefined;
}
