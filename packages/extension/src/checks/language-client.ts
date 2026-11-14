import {
  CHECK_PAGES_REQUEST,
  type CheckPagesParams,
  type CheckPagesResult,
  type FindingDiagnosticData,
} from "@lorequill/server/protocol";
import * as vscode from "vscode";
import {
  LanguageClient,
  TransportKind,
  type LanguageClientOptions,
  type ServerOptions,
} from "vscode-languageclient/node";
import { localizeFinding } from "../core/findings";
import type { Translate } from "../core/i18n";
import type { Logger } from "../core/logger";

function isFindingData(data: unknown): data is FindingDiagnosticData {
  return (
    typeof data === "object" &&
    data !== null &&
    typeof (data as { code?: unknown }).code === "string" &&
    typeof (data as { params?: unknown }).params === "object"
  );
}

/**
 * Starts the Lorequill language server in a separate Node process (specification §4). Call this
 * only in a trusted workspace. Diagnostics are shown in the display language.
 */
export async function startLanguageClient(
  context: vscode.ExtensionContext,
  outputChannel: vscode.LogOutputChannel,
  translate: Translate,
): Promise<LanguageClient> {
  const module = context.asAbsolutePath("dist/server.js");
  const serverOptions: ServerOptions = {
    run: { module, transport: TransportKind.ipc },
    debug: {
      module,
      transport: TransportKind.ipc,
      options: { execArgv: ["--nolazy", "--inspect=6011"] },
    },
  };
  const clientOptions: LanguageClientOptions = {
    documentSelector: [{ scheme: "file", language: "markdown" }],
    synchronize: { fileEvents: vscode.workspace.createFileSystemWatcher("**/*") },
    diagnosticCollectionName: "lorequill",
    outputChannel,
    middleware: {
      handleDiagnostics(uri, diagnostics, next) {
        for (const diagnostic of diagnostics) {
          // The client keeps LSP `data` on its diagnostic objects; the VS Code type omits it.
          const data = (diagnostic as { data?: unknown }).data;
          if (isFindingData(data)) {
            diagnostic.message = localizeFinding(
              translate,
              data.code,
              data.params,
              diagnostic.message,
            );
          }
        }
        next(uri, diagnostics);
      },
    },
  };
  const client = new LanguageClient("lorequill", "Lorequill", serverOptions, clientOptions);
  await client.start();
  return client;
}

/** Runs `Check Pages` on the server and returns the summaries of all folders. */
export async function checkPages(
  client: LanguageClient,
  params: CheckPagesParams = {},
): Promise<CheckPagesResult> {
  return client.sendRequest<CheckPagesResult>(CHECK_PAGES_REQUEST, params);
}

export const CHECK_PAGES_COMMAND = "lorequill.checkPages";

/**
 * Owns the language server client: starts it once, and only in a trusted workspace
 * (specification §15); a failed start can be retried. Runs `Check Pages` on it.
 */
export class LanguageServerController {
  private client: LanguageClient | undefined;
  private starting: Promise<LanguageClient | undefined> | undefined;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly channel: vscode.LogOutputChannel,
    private readonly translate: Translate,
    private readonly logger: Logger,
  ) {}

  /** Registers the trust listener and `Check Pages`, and starts the server when trusted. */
  register(subscriptions: vscode.Disposable[]): void {
    subscriptions.push(
      vscode.workspace.onDidGrantWorkspaceTrust(() => {
        void this.ensure();
      }),
      vscode.commands.registerCommand(CHECK_PAGES_COMMAND, () => this.runCheckPages()),
    );
    void this.ensure();
  }

  ensure(): Promise<LanguageClient | undefined> {
    if (!vscode.workspace.isTrusted) {
      return Promise.resolve(undefined);
    }
    this.starting ??= startLanguageClient(this.context, this.channel, this.translate).then(
      (client) => {
        this.client = client;
        this.logger.info("language-server", { status: "started" });
        return client;
      },
      () => {
        this.logger.warn("language-server", { status: "start-failed" });
        this.starting = undefined;
        return undefined;
      },
    );
    return this.starting;
  }

  running(): boolean {
    return this.client?.isRunning() ?? false;
  }

  /** `Check Pages` without user interface; `undefined` when checks are unavailable. */
  async checkPages(): Promise<CheckPagesResult | undefined> {
    const client = await this.ensure();
    return client ? checkPages(client) : undefined;
  }

  async stop(): Promise<void> {
    const client = this.client;
    this.client = undefined;
    this.starting = undefined;
    await client?.stop();
  }

  /** `Check Pages`: a complete check of the editing snapshot with a visible summary (§7). */
  private async runCheckPages(): Promise<void> {
    const translate = this.translate;
    const result = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Window, title: "Lorequill" },
      () => this.checkPages(),
    );
    const folders = (result?.folders ?? []).filter(({ status }) => status !== "unavailable");
    if (folders.length === 0) {
      this.logger.info("check-run", { status: "unavailable" });
      void vscode.window.showWarningMessage(translate("check.unavailable"));
      return;
    }
    const pages = folders.reduce((sum, folder) => sum + folder.pagesChecked, 0);
    const findings = folders.reduce((sum, folder) => sum + folder.findings, 0);
    const incomplete = folders.filter(({ status }) => status === "error");
    this.logger.info("check-run", {
      status: incomplete.length > 0 ? "error" : findings > 0 ? "failed" : "passed",
      pages,
      findings,
    });
    const showProblems = translate("check.showProblems");
    const open = (choice: string | undefined): void => {
      if (choice === showProblems) {
        void vscode.commands.executeCommand("workbench.actions.view.problems");
      }
    };
    if (incomplete.length > 0) {
      const reason = [...new Set(incomplete.map(({ errorCode }) => errorCode ?? "error"))].join(
        ", ",
      );
      void vscode.window
        .showWarningMessage(translate("check.incomplete", { reason }), showProblems)
        .then(open);
    } else if (findings > 0) {
      void vscode.window
        .showWarningMessage(translate("check.failed", { pages, findings }), showProblems)
        .then(open);
    } else {
      void vscode.window.showInformationMessage(translate("check.passed", { pages }));
    }
  }
}
