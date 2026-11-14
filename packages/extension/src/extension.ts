import { ENGINE_VERSION } from "@lorequill/checks";
import * as vscode from "vscode";
import { LanguageServerController } from "./checks/language-client";
import { engineMismatch } from "./core/engine-version";
import { createTranslator, selectLocale, type Translate } from "./core/i18n";
import { createLogger, type LogSink } from "./core/logger";
import { registerEditor } from "./editor/register";
import { FolderRegistry } from "./folders/folder-registry";
import { createGitProbe, GitAdapter } from "./git/git-adapter";
import { LinkMoveService } from "./links/link-move-service";
import { registerStableLinkCommand } from "./links/stable-link-command";
import { registerPages } from "./pages/register";
import { PROPERTIES_VIEW_ID, PropertiesViewProvider } from "./properties/properties-view";
import { registerReview } from "./review/register";
import { createTestApi, type LorequillInternalApi } from "./test-api";

export type { LorequillInternalApi } from "./test-api";

/** The language server outlives the subscriptions until `deactivate` has stopped it. */
let languageServer: LanguageServerController | undefined;

/** Shows the extension and engine versions, and every folder whose CI runs another engine. */
function showVersion(registry: FolderRegistry, translate: Translate, version: string): void {
  const info = translate("version.info", { version, engine: ENGINE_VERSION });
  const mismatches = registry.models().flatMap(({ folder, status }) => {
    const mismatch = status.kind === "ready" && engineMismatch(status.profile, ENGINE_VERSION);
    return mismatch
      ? [translate("version.mismatch", { folder: folder.name, expected: mismatch.expected })]
      : [];
  });
  if (mismatches.length === 0) {
    void vscode.window.showInformationMessage(info);
  } else {
    void vscode.window.showWarningMessage([info, ...mismatches].join(" "));
  }
}

function createOutputSink(channel: vscode.LogOutputChannel): LogSink {
  return {
    write(level, line) {
      if (level === "warn") {
        channel.warn(line);
      } else {
        channel.info(line);
      }
    },
  };
}

/**
 * The composition root: creates the shared services and registers each feature. The internal
 * API is returned in VS Code's test mode only.
 */
export function activate(context: vscode.ExtensionContext): LorequillInternalApi | undefined {
  const subscriptions = context.subscriptions;
  const version = (context.extension.packageJSON as { version: string }).version;
  // The display language is fixed for the lifetime of the extension host.
  const translate = createTranslator(selectLocale(vscode.env.language));
  const channel = vscode.window.createOutputChannel("Lorequill", { log: true });
  const logger = createLogger(createOutputSink(channel));
  const registry = new FolderRegistry(logger);
  const git = new GitAdapter(registry, logger);
  subscriptions.push(channel, registry, git);

  const server = new LanguageServerController(context, channel, translate, logger);
  languageServer = server;
  const pages = registerPages(subscriptions, registry, translate);
  const editor = registerEditor(subscriptions, context.extensionUri, registry, translate);
  const properties = new PropertiesViewProvider(context.extensionUri, registry, translate);
  const review = registerReview(subscriptions, {
    registry,
    git,
    memento: context.workspaceState,
    translate,
    logger,
    activeFolder: () => {
      const uri =
        editor.pageEditor.activePage()?.document.uri ??
        vscode.window.activeTextEditor?.document.uri;
      return uri && vscode.workspace.getWorkspaceFolder(uri);
    },
  });

  subscriptions.push(
    properties,
    new LinkMoveService(registry, translate, logger),
    registerStableLinkCommand(
      registry,
      translate,
      () =>
        editor.pageEditor.activePage()?.document.uri ??
        vscode.window.activeTextEditor?.document.uri,
    ),
    vscode.window.registerWebviewViewProvider(PROPERTIES_VIEW_ID, properties),
    // A checkout, also one outside VS Code, can change every page; rescan instead of waiting
    // for the burst of file events.
    git.onDidChangeHead(() => {
      registry.refresh();
    }),
    vscode.commands.registerCommand("lorequill.showVersion", () => {
      showVersion(registry, translate, version);
    }),
  );

  logger.info("activated", { trusted: registry.trusted });
  server.register(subscriptions);
  registry.start();
  git.start();
  void vscode.commands.executeCommand("setContext", "lorequill.enabled", true);

  if (context.extensionMode !== vscode.ExtensionMode.Test) {
    return undefined;
  }
  return createTestApi({
    registry,
    pages: pages.provider,
    setPageFilter: pages.setFilter,
    outline: editor.outline,
    pageEditor: editor.pageEditor,
    properties,
    links: editor.links,
    git,
    gitProbe: createGitProbe(git, registry),
    commits: review.commits,
    submissions: review.submissions,
    reviewStore: review.store,
    reviewStatus: review.statusBar,
    translate,
    languageServerRunning: () => server.running(),
    checkPages: () => server.checkPages(),
  });
}

export async function deactivate(): Promise<void> {
  // Other resources are disposed through the subscriptions of the extension context.
  const server = languageServer;
  languageServer = undefined;
  await server?.stop();
}
