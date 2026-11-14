import { join, relative, sep } from "node:path";
import {
  createFileSystemSnapshot,
  createRunCache,
  runChecks,
  withOverrides,
  type CheckResult,
  type Finding,
  type RunCache,
} from "@lorequill/checks";
import { loadProfile, type Profile } from "@lorequill/profile";
import { DiagnosticSeverity, type Diagnostic } from "vscode-languageserver";
import { URI } from "vscode-uri";
import type { FindingDiagnosticData, FolderCheckSummary } from "./protocol";

/** An open text document as the server sees it. */
export interface OpenDocument {
  readonly uri: string;
  readonly version: number;
  readonly text: string;
}

/** What a folder checker needs from the language server connection. */
export interface FolderCheckerHost {
  openDocuments(): readonly OpenDocument[];
  /** The current version of an open document, or `undefined` if it is closed. */
  documentVersion(uri: string): number | undefined;
  publish(uri: string, diagnostics: Diagnostic[], version?: number): void;
  status(summary: FolderCheckSummary): void;
}

/** Waiting time after the last change before a check starts (§7: "after a short pause"). */
export const DEFAULT_DEBOUNCE_MS = 400;

/**
 * Checks one workspace folder: loads its profile, runs the engine on the editing snapshot (files on
 * disk plus unsaved buffers), and publishes diagnostics. Each folder has its own profile, cache,
 * and published diagnostics, so folders never mix (§4).
 *
 * Results are tagged with the document versions they were computed from; a result is discarded if
 * an open document changed while it ran, and a new run is scheduled instead (§11).
 */
export class FolderChecker {
  private profile: Profile | undefined;
  private contentRoot: string | undefined;
  private cache: RunCache = createRunCache();
  private published = new Set<string>();
  private timer: NodeJS.Timeout | undefined;
  private controller: AbortController | undefined;
  private disposed = false;

  readonly folderPath: string;

  constructor(
    readonly folderUri: string,
    private readonly host: FolderCheckerHost,
    private readonly debounceMs = DEFAULT_DEBOUNCE_MS,
  ) {
    this.folderPath = URI.parse(folderUri).fsPath;
  }

  /** Loads (or reloads) the profile. Without a usable profile, diagnostics are cleared. */
  async reload(): Promise<void> {
    const loaded = await loadProfile(this.folderPath);
    this.profile = loaded.ok ? loaded.profile : undefined;
    this.contentRoot = loaded.ok
      ? join(this.folderPath, ...loaded.profile.content.root.split("/"))
      : undefined;
    this.cache = createRunCache();
    if (!this.profile) {
      this.clear();
    }
  }

  /** Whether a file path belongs to this folder. */
  contains(fsPath: string): boolean {
    const fromFolder = relative(this.folderPath, fsPath);
    return fromFolder !== "" && !fromFolder.startsWith(`..${sep}`) && fromFolder !== "..";
  }

  /** Schedules a check after the debounce time, replacing a pending one. */
  schedule(delayMs = this.debounceMs): void {
    if (this.disposed) {
      return;
    }
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      void this.checkNow();
    }, delayMs);
  }

  /** Cancels a running check and runs a new one immediately. */
  async checkNow(): Promise<FolderCheckSummary> {
    clearTimeout(this.timer);
    this.controller?.abort();
    const controller = new AbortController();
    this.controller = controller;
    return this.run(controller.signal);
  }

  dispose(): void {
    this.disposed = true;
    clearTimeout(this.timer);
    this.controller?.abort();
    this.clear();
  }

  private async run(signal: AbortSignal): Promise<FolderCheckSummary> {
    const { profile, contentRoot } = this;
    if (!profile || !contentRoot) {
      return { folderUri: this.folderUri, status: "unavailable", findings: 0, pagesChecked: 0 };
    }

    const overrides = new Map<string, string>();
    const versions = new Map<string, number>();
    for (const document of this.host.openDocuments()) {
      const path = URI.parse(document.uri).fsPath;
      const fromRoot = relative(contentRoot, path);
      if (fromRoot === "" || fromRoot.startsWith("..") || fromRoot.includes(":")) {
        continue;
      }
      overrides.set(fromRoot.split(sep).join("/"), document.text);
      versions.set(document.uri, document.version);
    }

    const result = await runChecks({
      profile,
      snapshot: withOverrides(createFileSystemSnapshot(contentRoot), overrides),
      signal,
      cache: this.cache,
    });
    if (signal.aborted || this.disposed) {
      return summarize(this.folderUri, result);
    }
    for (const [uri, version] of versions) {
      if (this.host.documentVersion(uri) !== version) {
        // A newer version exists; this result must not replace newer diagnostics.
        this.schedule();
        return summarize(this.folderUri, result);
      }
    }

    this.publishFindings(result.findings, versions);
    const summary = summarize(this.folderUri, result);
    this.host.status(summary);
    return summary;
  }

  private publishFindings(
    findings: readonly Finding[],
    versions: ReadonlyMap<string, number>,
  ): void {
    const byUri = new Map<string, Diagnostic[]>();
    for (const finding of findings) {
      const uri = URI.file(join(this.folderPath, ...finding.path.split("/"))).toString();
      let diagnostics = byUri.get(uri);
      if (!diagnostics) {
        diagnostics = [];
        byUri.set(uri, diagnostics);
      }
      diagnostics.push(toDiagnostic(finding));
    }
    const versionOf = (uri: string): number | undefined => {
      const fsPath = URI.parse(uri).fsPath;
      for (const [open, version] of versions) {
        if (URI.parse(open).fsPath === fsPath) {
          return version;
        }
      }
      return undefined;
    };
    for (const uri of this.published) {
      if (!byUri.has(uri)) {
        this.host.publish(uri, [], versionOf(uri));
      }
    }
    for (const [uri, diagnostics] of byUri) {
      this.host.publish(uri, diagnostics, versionOf(uri));
    }
    this.published = new Set(byUri.keys());
  }

  private clear(): void {
    for (const uri of this.published) {
      this.host.publish(uri, []);
    }
    this.published.clear();
  }
}

/** Converts a finding into an LSP diagnostic; positions are 0-based UTF-16 like the engine's. */
export function toDiagnostic(finding: Finding): Diagnostic {
  const line = finding.line - 1;
  const character = (finding.column ?? 1) - 1;
  const data: FindingDiagnosticData = { code: finding.code, params: finding.params };
  return {
    range: {
      start: { line, character },
      end: {
        line: (finding.endLine ?? finding.line) - 1,
        character: (finding.endColumn ?? finding.column ?? 1) - 1,
      },
    },
    severity: DiagnosticSeverity.Error,
    source: "Lorequill",
    code: finding.ruleId,
    message: finding.message,
    data,
  };
}

function summarize(folderUri: string, result: CheckResult): FolderCheckSummary {
  return {
    folderUri,
    status: result.status,
    findings: result.findings.length,
    pagesChecked: result.pagesChecked,
    ...(result.error ? { errorCode: result.error.code } : {}),
    engineVersion: result.engineVersion,
    snapshotId: result.snapshotId,
  };
}
