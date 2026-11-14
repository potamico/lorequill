/**
 * Messages between the Lorequill extension and its language server, in addition to standard LSP.
 * This module has no dependencies, so both sides can import it.
 */

/** Request: run a complete check of the editing snapshot (`Check Pages`, §7). */
export const CHECK_PAGES_REQUEST = "lorequill/checkPages";

export interface CheckPagesParams {
  /** Limits the check to one workspace folder; all folders when absent. */
  readonly folderUri?: string;
}

export interface FolderCheckSummary {
  readonly folderUri: string;
  /** `unavailable`: the folder has no usable profile, so nothing was checked. */
  readonly status: "passed" | "failed" | "error" | "unavailable";
  readonly findings: number;
  readonly pagesChecked: number;
  /** Why an `error` run was incomplete, for example `timeout`. */
  readonly errorCode?: string;
  readonly engineVersion?: string;
  readonly snapshotId?: string;
}

export interface CheckPagesResult {
  readonly folders: readonly FolderCheckSummary[];
}

/** Notification from the server after every completed check run of a folder. */
export const CHECK_STATUS_NOTIFICATION = "lorequill/checkStatus";

/** Carried in `Diagnostic.data`, so the client can show the message in the display language. */
export interface FindingDiagnosticData {
  readonly code: string;
  readonly params: Readonly<Record<string, string | number>>;
}
