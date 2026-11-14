import { PROFILE_RELATIVE_PATH } from "@lorequill/profile";
import { TextDocument } from "vscode-languageserver-textdocument";
import {
  createConnection,
  ProposedFeatures,
  TextDocuments,
  TextDocumentSyncKind,
  type WorkspaceFolder,
} from "vscode-languageserver/node";
import { URI } from "vscode-uri";
import { FolderChecker, type FolderCheckerHost } from "./folder-checker";
import {
  CHECK_PAGES_REQUEST,
  CHECK_STATUS_NOTIFICATION,
  type CheckPagesParams,
  type CheckPagesResult,
} from "./protocol";

/**
 * Entry point of the Lorequill language server (specification §4). The extension starts it only in
 * trusted workspaces. It provides diagnostics only; it is not a replacement for the built-in
 * Markdown language service.
 */
const connection = createConnection(ProposedFeatures.all);
const documents = new TextDocuments(TextDocument);
const checkers = new Map<string, FolderChecker>();

const host: FolderCheckerHost = {
  openDocuments: () =>
    documents.all().map((document) => ({
      uri: document.uri,
      version: document.version,
      text: document.getText(),
    })),
  documentVersion: (uri) => documents.get(uri)?.version,
  publish: (uri, diagnostics, version) => {
    void connection.sendDiagnostics({
      uri,
      diagnostics,
      ...(version === undefined ? {} : { version }),
    });
  },
  status: (summary) => {
    void connection.sendNotification(CHECK_STATUS_NOTIFICATION, summary);
  },
};

const IGNORED = /[\\/](?:\.git|node_modules)(?:[\\/]|$)/;

/** The checker of the innermost workspace folder that contains a file. */
function checkerFor(uri: string): FolderChecker | undefined {
  const fsPath = URI.parse(uri).fsPath;
  let best: FolderChecker | undefined;
  for (const checker of checkers.values()) {
    if (checker.contains(fsPath) && (!best || checker.folderPath.length > best.folderPath.length)) {
      best = checker;
    }
  }
  return best;
}

async function addFolder(folder: WorkspaceFolder): Promise<void> {
  if (checkers.has(folder.uri)) {
    return;
  }
  const checker = new FolderChecker(folder.uri, host);
  checkers.set(folder.uri, checker);
  await checker.reload();
  checker.schedule(0);
}

function removeFolder(folder: WorkspaceFolder): void {
  checkers.get(folder.uri)?.dispose();
  checkers.delete(folder.uri);
}

let initialFolders: WorkspaceFolder[] = [];

connection.onInitialize((params) => {
  initialFolders = params.workspaceFolders ?? [];
  return {
    capabilities: {
      textDocumentSync: TextDocumentSyncKind.Incremental,
      workspace: { workspaceFolders: { supported: true, changeNotifications: true } },
    },
    serverInfo: { name: "Lorequill" },
  };
});

connection.onInitialized(() => {
  for (const folder of initialFolders) {
    void addFolder(folder);
  }
  connection.workspace.onDidChangeWorkspaceFolders((event) => {
    event.removed.forEach(removeFolder);
    for (const folder of event.added) {
      void addFolder(folder);
    }
  });
});

documents.onDidChangeContent((event) => {
  checkerFor(event.document.uri)?.schedule();
});
documents.onDidSave((event) => {
  checkerFor(event.document.uri)?.schedule(0);
});
documents.onDidClose((event) => {
  // The file on disk replaces the closed buffer.
  checkerFor(event.document.uri)?.schedule();
});

connection.onDidChangeWatchedFiles(async (params) => {
  const reload = new Set<FolderChecker>();
  const rerun = new Set<FolderChecker>();
  for (const change of params.changes) {
    const fsPath = URI.parse(change.uri).fsPath;
    if (IGNORED.test(fsPath)) {
      continue;
    }
    const checker = checkerFor(change.uri);
    if (!checker) {
      continue;
    }
    const fromFolder = fsPath
      .slice(checker.folderPath.length + 1)
      .split(/[\\/]/)
      .join("/");
    (fromFolder === PROFILE_RELATIVE_PATH ? reload : rerun).add(checker);
  }
  for (const checker of reload) {
    await checker.reload();
    checker.schedule(0);
  }
  for (const checker of rerun) {
    if (!reload.has(checker)) {
      checker.schedule();
    }
  }
});

connection.onRequest(
  CHECK_PAGES_REQUEST,
  async (params: CheckPagesParams | undefined): Promise<CheckPagesResult> => {
    const selected = [...checkers.values()].filter(
      (checker) => params?.folderUri === undefined || checker.folderUri === params.folderUri,
    );
    return { folders: await Promise.all(selected.map((checker) => checker.checkNow())) };
  },
);

connection.onShutdown(() => {
  for (const checker of checkers.values()) {
    checker.dispose();
  }
  checkers.clear();
});

documents.listen(connection);
connection.listen();
