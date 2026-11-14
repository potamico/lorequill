import type { ProfileIssueCode } from "@lorequill/profile";
import type { FolderStatus } from "./folder-status";
import type { CommitFlowResult, VerifyResult } from "./git/commit-plan";
import type { SubmitLogCode } from "./host/submit";

/**
 * Operational logger (specification section 15). It records events, counts, and state names
 * only. It cannot record page bodies, front matter values, titles, file names, profile values,
 * tokens, or free-form messages: the type of a field value is a number, a boolean, or a member of
 * the closed {@link LogCode} set, and anything else that reaches the logger anyway is replaced.
 */
export type LogEvent =
  | "activated"
  | "workspace-trust"
  | "folder-added"
  | "folder-removed"
  | "profile-loaded"
  | "pages-scanned"
  | "language-server"
  | "check-run"
  | "git"
  | "commit"
  | "verify-commit"
  | "submit"
  | "link-update";

/** Closed vocabulary for string field values. */
export type LogCode =
  | FolderStatus["kind"]
  | ProfileIssueCode
  | CommitFlowResult
  | SubmitLogCode
  | VerifyResult
  | "trusted"
  | "untrusted"
  | "started"
  | "start-failed"
  | "stopped"
  | "passed"
  | "failed"
  | "error"
  | "unavailable";

export type LogValue = number | boolean | LogCode;
export type LogFields = Readonly<Record<string, LogValue>>;
export type LogLevel = "info" | "warn";

/** Where formatted lines go; the extension writes them to a VS Code output channel. */
export interface LogSink {
  write(level: LogLevel, line: string): void;
}

export interface Logger {
  info(event: LogEvent, fields?: LogFields): void;
  warn(event: LogEvent, fields?: LogFields): void;
}

const SAFE_CODE = /^[a-z][a-z0-9-]{0,63}$/;
const SAFE_KEY = /^[a-z][A-Za-z0-9]{0,31}$/;

function formatValue(value: unknown): string {
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  if (typeof value === "boolean") {
    return String(value);
  }
  // Defense in depth: types already restrict strings to LogCode, which matches this pattern.
  return typeof value === "string" && SAFE_CODE.test(value) ? value : "redacted";
}

export function formatLogLine(event: LogEvent, fields: LogFields = {}): string {
  const parts: string[] = [event];
  for (const key of Object.keys(fields).sort()) {
    if (SAFE_KEY.test(key)) {
      parts.push(`${key}=${formatValue(fields[key])}`);
    }
  }
  return parts.join(" ");
}

export function createLogger(sink: LogSink): Logger {
  return {
    info: (event, fields) => {
      sink.write("info", formatLogLine(event, fields));
    },
    warn: (event, fields) => {
      sink.write("warn", formatLogLine(event, fields));
    },
  };
}
