import type { Profile, ProfileIssue, ProfileResult } from "@lorequill/profile";
import type { MessageKey, Translate } from "./i18n";

/** Why the content root of a valid profile cannot be used. */
export type ContentRootProblem = "missing" | "outside";

/**
 * State of one workspace folder. Every folder has its own state, so folders with different
 * profiles never influence each other (specification section 4).
 */
export type FolderStatus =
  | { readonly kind: "unsupported-location" }
  | { readonly kind: "profile-missing" }
  | { readonly kind: "profile-unsupported"; readonly issue: ProfileIssue }
  | { readonly kind: "profile-invalid"; readonly issues: readonly ProfileIssue[] }
  | {
      readonly kind: "content-root-invalid";
      readonly problem: ContentRootProblem;
      readonly root: string;
    }
  | { readonly kind: "scan-failed" }
  | { readonly kind: "ready"; readonly profile: Profile };

/** Classifies the result of loading `.lorequill/config.yaml`. */
export function classifyProfileResult(result: ProfileResult): FolderStatus {
  if (result.ok) {
    return { kind: "ready", profile: result.profile };
  }
  const [first] = result.issues;
  if (first?.code === "profile-not-found") {
    return { kind: "profile-missing" };
  }
  if (first?.code === "unsupported-version") {
    return { kind: "profile-unsupported", issue: first };
  }
  return { kind: "profile-invalid", issues: result.issues };
}

/** Message shown for a folder that cannot be used, with details for a tooltip. */
export interface StatusMessage {
  readonly message: string;
  /** One line per problem, for example the first ten problems of an invalid profile. */
  readonly details: readonly string[];
  /** 1-based line in the profile where the first problem is, so the profile can be opened there. */
  readonly profileLine?: number;
  /** Whether the message points at a profile that exists and can be opened. */
  readonly canOpenProfile: boolean;
}

const MAX_DETAILS = 10;

/** Describes one profile problem in a single localized line. */
export function describeIssue(issue: ProfileIssue, translate: Translate): string {
  const message = translate(`profile.issue.${issue.code}`, {
    ...issue.params,
    path: issue.path === "" ? "/" : issue.path,
  });
  return issue.line === undefined
    ? translate("profile.problem", { message })
    : translate("profile.problemAtLine", { line: issue.line, message });
}

function messageKeyOf(status: Exclude<FolderStatus, { kind: "ready" }>): MessageKey {
  switch (status.kind) {
    case "unsupported-location":
      return "folder.unsupportedLocation";
    case "profile-missing":
      return "folder.profileMissing";
    case "profile-unsupported":
      return "folder.profileUnsupported";
    case "profile-invalid":
      return "folder.profileInvalid";
    case "content-root-invalid":
      return status.problem === "missing"
        ? "folder.contentRootMissing"
        : "folder.contentRootOutside";
    case "scan-failed":
      return "folder.scanFailed";
  }
}

/** Produces the one actionable, localized message for a folder whose status is not `ready`. */
export function describeStatus(
  status: Exclude<FolderStatus, { kind: "ready" }>,
  translate: Translate,
): StatusMessage {
  const key = messageKeyOf(status);
  switch (status.kind) {
    case "profile-unsupported": {
      const params = status.issue.params ?? {};
      return {
        message: translate(key, { found: params.found ?? "?", supported: params.supported ?? "?" }),
        details: [],
        ...(status.issue.line === undefined ? {} : { profileLine: status.issue.line }),
        canOpenProfile: true,
      };
    }
    case "profile-invalid": {
      const [first] = status.issues;
      return {
        message: translate(key, {
          detail: first ? describeIssue(first, translate) : "",
          count: status.issues.length,
        }),
        details: status.issues
          .slice(0, MAX_DETAILS)
          .map((issue) => describeIssue(issue, translate)),
        ...(first?.line === undefined ? {} : { profileLine: first.line }),
        // A file that cannot be read or is not a regular file is not worth opening.
        canOpenProfile:
          first?.code !== "profile-outside-workspace" && first?.code !== "profile-not-a-file",
      };
    }
    case "content-root-invalid":
      return {
        message: translate(key, { root: status.root }),
        details: [],
        canOpenProfile: true,
      };
    case "profile-missing":
    case "unsupported-location":
    case "scan-failed":
      return { message: translate(key), details: [], canOpenProfile: false };
  }
}
