import Ajv2020, { type ErrorObject } from "ajv/dist/2020.js";
import type { Profile } from "./generated/profile";
import type { ProfileIssue, ProfileIssueCode, ProfileIssueParams, ProfileResult } from "./issues";
import profileSchema from "../schema/profile.schema.json";

/** The only profile format version this package understands. */
export const PROFILE_VERSION = 1;

/** Run-level check timeout applied when `checks.timeout_seconds` is omitted (spec section 6). */
export const DEFAULT_CHECK_TIMEOUT_SECONDS = 30;

/** Upper bound for reported issues so that hostile input cannot produce unbounded output. */
const MAX_ISSUES = 50;

// Ajv compiles the schema to a validation function once. The schema is bundled with this package
// and never loaded from the repository being validated.
const ajv = new Ajv2020({ strict: true, allErrors: true, discriminator: true, verbose: true });
const validateAgainstSchema = ajv.compile<Profile>(profileSchema);

export { profileSchema };

/**
 * Validates already-parsed profile data: version check, closed schema, then cross-reference checks
 * that JSON Schema cannot express (unique IDs and keys, select defaults).
 *
 * Issues carry JSON Pointer paths but no source locations; `parseProfile` adds those.
 */
export function validateProfileData(data: unknown): ProfileResult {
  const versionIssue = checkVersion(data);
  if (versionIssue) {
    return { ok: false, issues: [versionIssue] };
  }

  if (!validateAgainstSchema(data)) {
    const issues = dedupe((validateAgainstSchema.errors ?? []).map(mapAjvError)).slice(
      0,
      MAX_ISSUES,
    );
    return { ok: false, issues };
  }

  const issues = checkCrossReferences(data);
  if (issues.length > 0) {
    return { ok: false, issues: issues.slice(0, MAX_ISSUES) };
  }
  return { ok: true, profile: data };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function describeValue(value: unknown): string {
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value).slice(0, 50);
  }
  return Array.isArray(value) ? "array" : value === null ? "null" : typeof value;
}

function checkVersion(data: unknown): ProfileIssue | undefined {
  if (!isRecord(data) || !("version" in data) || data.version === PROFILE_VERSION) {
    return undefined;
  }
  return {
    code: "unsupported-version",
    path: "/version",
    params: { found: describeValue(data.version), supported: PROFILE_VERSION },
  };
}

function mapAjvError(error: ErrorObject): ProfileIssue {
  const params = error.params as Record<string, unknown>;
  const make = (
    code: ProfileIssueCode,
    path: string,
    issueParams?: ProfileIssueParams,
  ): ProfileIssue => (issueParams ? { code, path, params: issueParams } : { code, path });

  switch (error.keyword) {
    case "additionalProperties": {
      const key = String(params.additionalProperty);
      return make("unknown-key", `${error.instancePath}/${escapePointer(key)}`, { key });
    }
    case "required": {
      const key = String(params.missingProperty);
      return make("missing-key", `${error.instancePath}/${escapePointer(key)}`, { key });
    }
    case "discriminator": {
      // Produced for check rules (tag "rule") and collection fields (tag "widget").
      const tag = typeof params.tag === "string" ? params.tag : "rule";
      const tagPath = `${error.instancePath}/${escapePointer(tag)}`;
      const tagMissing = isRecord(error.data) && !(tag in error.data);
      if (tagMissing) {
        return make("missing-key", tagPath, { key: tag });
      }
      if (params.error === "mapping") {
        const code = tag === "widget" ? "unknown-widget" : "unknown-rule";
        return make(code, tagPath, { value: describeValue(params.tagValue) });
      }
      return make("invalid-type", tagPath, { expected: "string" });
    }
    case "type":
      return make("invalid-type", error.instancePath, { expected: String(params.type) });
    default:
      return make("invalid-value", error.instancePath, { constraint: error.keyword });
  }
}

function escapePointer(segment: string): string {
  return segment.replaceAll("~", "~0").replaceAll("/", "~1");
}

function dedupe(issues: ProfileIssue[]): ProfileIssue[] {
  const seen = new Set<string>();
  return issues.filter((issue) => {
    const key = `${issue.code}\u0000${issue.path}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function checkCrossReferences(profile: Profile): ProfileIssue[] {
  const issues: ProfileIssue[] = [];

  const ruleIds = new Set<string>();
  (profile.checks?.rules ?? []).forEach((rule, index) => {
    if (ruleIds.has(rule.id)) {
      issues.push({
        code: "duplicate-id",
        path: `/checks/rules/${String(index)}/id`,
        params: { id: rule.id },
      });
    }
    ruleIds.add(rule.id);
  });

  const collectionIds = new Set<string>();
  (profile.collections ?? []).forEach((collection, collectionIndex) => {
    const collectionPath = `/collections/${String(collectionIndex)}`;
    if (collectionIds.has(collection.id)) {
      issues.push({
        code: "duplicate-id",
        path: `${collectionPath}/id`,
        params: { id: collection.id },
      });
    }
    collectionIds.add(collection.id);

    const fieldKeys = new Set<string>();
    (collection.fields ?? []).forEach((field, fieldIndex) => {
      const fieldPath = `${collectionPath}/fields/${String(fieldIndex)}`;
      if (fieldKeys.has(field.key)) {
        issues.push({
          code: "duplicate-field-key",
          path: `${fieldPath}/key`,
          params: { key: field.key },
        });
      }
      fieldKeys.add(field.key);

      if (field.widget === "select" && field.default !== undefined) {
        if (!field.options.includes(field.default)) {
          issues.push({ code: "invalid-default", path: `${fieldPath}/default` });
        }
      }
    });
  });

  return issues;
}
