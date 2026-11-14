import {
  LineCounter,
  isAlias,
  isMap,
  isNode,
  isScalar,
  parseDocument,
  visit,
  type Document,
  type Node,
} from "yaml";
import type { ProfileIssue, ProfileResult } from "./issues";
import { validateProfileData } from "./validate";

/**
 * Parses profile YAML as data and validates it.
 *
 * - Profiles are parsed with the YAML 1.2 core schema only. Custom or unknown tags (for example
 *   `!!js/function`) are rejected and nothing is ever executed.
 * - Duplicate keys, multiple documents, anchors, aliases, and merge keys are rejected.
 * - The result never mixes YAML-level and schema-level issues: a document that is not valid YAML
 *   is reported without schema validation.
 */
export function parseProfile(text: string): ProfileResult {
  const lineCounter = new LineCounter();
  const document = parseDocument(text, {
    lineCounter,
    version: "1.2",
    schema: "core",
    uniqueKeys: true,
    merge: false,
    prettyErrors: false,
  });

  const yamlIssues = collectYamlIssues(document, lineCounter);
  if (yamlIssues.length > 0) {
    return { ok: false, issues: yamlIssues };
  }

  if (document.contents === null) {
    return { ok: false, issues: [{ code: "profile-empty", path: "" }] };
  }

  const result = validateProfileData(document.toJS());
  if (result.ok) {
    return result;
  }
  return { ok: false, issues: result.issues.map((issue) => locate(document, lineCounter, issue)) };
}

function collectYamlIssues(document: Document.Parsed, lineCounter: LineCounter): ProfileIssue[] {
  const issues: ProfileIssue[] = [];

  for (const error of document.errors) {
    const code = error.code === "DUPLICATE_KEY" ? "yaml-duplicate-key" : "yaml-syntax";
    issues.push({
      code,
      path: "",
      ...position(lineCounter, error.pos[0]),
      params: { yamlCode: error.code },
    });
  }

  for (const warning of document.warnings) {
    // Unresolved tags are reported by the node visitor below, together with resolved ones.
    if (warning.code !== "TAG_RESOLVE_FAILED") {
      issues.push({
        code: "yaml-unsupported-construct",
        path: "",
        ...position(lineCounter, warning.pos[0]),
        params: { construct: warning.code },
      });
    }
  }

  // Profiles use plain YAML data only. The core schema still resolves some explicit tags such as
  // !!binary, !!set, or !!timestamp into non-plain values, so every explicit tag is rejected.
  // Anchors and aliases are data-safe but unnecessary for profiles and enable expansion attacks.
  visit(document, (_key, node) => {
    const construct = unsupportedConstruct(node);
    if (construct !== undefined && isNode(node)) {
      issues.push({
        code: "yaml-unsupported-construct",
        path: "",
        ...position(lineCounter, node.range?.[0]),
        params: { construct },
      });
    }
  });

  return issues;
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

function position(
  lineCounter: LineCounter,
  offset: number | undefined,
): { line: number; column: number } | Record<string, never> {
  if (offset === undefined) {
    return {};
  }
  const { line, col } = lineCounter.linePos(offset);
  return { line, column: col };
}

function decodePointer(pointer: string): string[] {
  if (pointer === "") {
    return [];
  }
  return pointer
    .slice(1)
    .split("/")
    .map((segment) => segment.replaceAll("~1", "/").replaceAll("~0", "~"));
}

/** Adds a source location to an issue by resolving its JSON Pointer in the YAML document. */
function locate(
  document: Document.Parsed,
  lineCounter: LineCounter,
  issue: ProfileIssue,
): ProfileIssue {
  const segments = decodePointer(issue.path);

  // For unknown keys, point at the key itself instead of its value.
  if (issue.code === "unknown-key" && segments.length > 0) {
    const key = segments[segments.length - 1];
    const parent = document.getIn(segments.slice(0, -1), true);
    if (isMap(parent)) {
      const pair = parent.items.find((item) => isScalar(item.key) && item.key.value === key);
      const offset = isNode(pair?.key) ? pair.key.range?.[0] : undefined;
      if (offset !== undefined) {
        return { ...issue, ...position(lineCounter, offset) };
      }
    }
  }

  // Otherwise use the deepest node that exists (missing keys resolve to their parent).
  for (let depth = segments.length; depth >= 0; depth--) {
    const node = document.getIn(
      segments
        .slice(0, depth)
        .map((segment) => (/^\d+$/.test(segment) ? Number(segment) : segment)),
      true,
    ) as Node | undefined;
    const offset = isNode(node) ? node.range?.[0] : undefined;
    if (offset !== undefined) {
      return { ...issue, ...position(lineCounter, offset) };
    }
  }
  return issue;
}
