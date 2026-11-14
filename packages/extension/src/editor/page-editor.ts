import { randomBytes } from "node:crypto";
import {
  EDITOR_LABEL_KEYS,
  LIMITS,
  parseWebviewMessage,
  type EditorCommand,
  type EditorDiagnostic,
  type EditorLabels,
  type EditorSettings,
  type HostAction,
  type HostMessage,
  type PageLocation,
  type TextChange,
  type WebviewMessage,
} from "@lorequill/editor";
import { posix } from "node:path";
import { resolveLinkDestination } from "@lorequill/markdown";
import * as vscode from "vscode";
import type { LinkService } from "./link-service";
import type { MessageKey, Translate } from "../core/i18n";
import { findAnchorLine } from "../core/outline";
import { countWords, readingMinutes } from "../core/page-stats";
import { pathInside } from "../folders/uri-paths";

/** View type of the Lorequill page editor (specification §8, decision D23). */
export const PAGE_EDITOR_VIEW_TYPE = "lorequill.pageEditor";

/** One open Lorequill editor, exposed to the extension's integration tests. */
export interface EditorSessionProbe {
  readonly uri: vscode.Uri;
  /** Messages sent to the webview, oldest first. */
  readonly sent: readonly HostMessage[];
  /** Feeds a message as if the webview had sent it; resolves when it was processed. */
  receive(message: unknown): Promise<void>;
}

function readSettings(document: vscode.TextDocument): EditorSettings {
  const editor = vscode.workspace.getConfiguration("editor", {
    uri: document.uri,
    languageId: document.languageId,
  });
  const fontSize = editor.get<number>("fontSize", 14);
  const tabSize = editor.get<number | string>("tabSize", 4);
  return {
    fontFamily: editor.get<string>("fontFamily", "monospace").slice(0, 1000),
    fontSize: fontSize > 0 && fontSize <= 200 ? fontSize : 14,
    tabSize: typeof tabSize === "number" && tabSize >= 1 && tabSize <= 16 ? Math.round(tabSize) : 4,
    wordWrap: editor.get<string>("wordWrap", "off") !== "off",
    maxTextWidth: readMaxTextWidth(document),
  };
}

/** `lorequill.editor.maxTextWidth`: the text column width in `Edit` (§8). */
function readMaxTextWidth(document: vscode.TextDocument): number {
  const width = vscode.workspace
    .getConfiguration("lorequill.editor", document.uri)
    .get<number>("maxTextWidth", 800);
  return typeof width === "number" && Number.isFinite(width)
    ? Math.min(Math.max(Math.round(width), 0), 10_000)
    : 800;
}

/** Toolbar and widget texts in the display language (catalog keys `editor.label.*`). */
function readLabels(translate: Translate): EditorLabels {
  return Object.fromEntries(
    EDITOR_LABEL_KEYS.map((key) => [key, translate(`editor.label.${key}` as MessageKey)]),
  ) as EditorLabels;
}

/** How long a save or undo waits for the webview to send collected typing. */
const FLUSH_TIMEOUT_MS = 1000;

/** What the session needs from its provider. */
interface SessionHost {
  /** Toolbar and widget texts in the display language. */
  readonly labels: EditorLabels;
  act(session: EditorSession, action: HostAction): Promise<void>;
  selectionChanged(session: EditorSession): void;
  openLink(session: EditorSession, target: string): Promise<void>;
  /** Insert Link: lets the author choose a link and sends it to the webview. */
  insertLink(session: EditorSession, selection: string): Promise<void>;
  /** Link completion inside a destination. */
  complete(session: EditorSession, id: number, anchorsOf: string | undefined): Promise<void>;
  /** The page's place in its content root, for images in the rendered preview. */
  pageLocation(session: EditorSession, webview: vscode.Webview): PageLocation | undefined;
}

function toRange(change: TextChange): vscode.Range {
  return new vscode.Range(
    change.from.line,
    change.from.character,
    change.to.line,
    change.to.character,
  );
}

function toDiagnostics(uri: vscode.Uri): EditorDiagnostic[] {
  return vscode.languages.getDiagnostics(uri).map((diagnostic) => ({
    from: { line: diagnostic.range.start.line, character: diagnostic.range.start.character },
    to: { line: diagnostic.range.end.line, character: diagnostic.range.end.character },
    severity:
      diagnostic.severity === vscode.DiagnosticSeverity.Error
        ? "error"
        : diagnostic.severity === vscode.DiagnosticSeverity.Warning
          ? "warning"
          : "info",
    message: diagnostic.message.slice(0, 10_000),
    ...(diagnostic.source === undefined ? {} : { source: diagnostic.source.slice(0, 200) }),
  }));
}

/**
 * Connects one webview to its `TextDocument` (specification §7). The document is authoritative:
 * webview edits are applied through `WorkspaceEdit` only when they are based on the current
 * version; every other document change (undo, redo, other editors, the properties panel, disk) is
 * forwarded to the webview. Messages are processed strictly in order.
 */
class EditorSession implements EditorSessionProbe {
  readonly sent: HostMessage[] = [];
  private queue: Promise<void> = Promise.resolve();
  private applying: { readonly id: number; readonly version: number } | undefined;
  private lastAcknowledged: number | undefined;
  private nextFlushToken = 1;
  private readonly flushes = new Map<number, () => void>();
  /** Cursor position reported by the webview, 0-based. */
  position = { line: 0, character: 0 };
  /** The webview has received the document; until then a reveal waits. */
  private initialized = false;
  private pendingReveal: number | undefined;

  constructor(
    readonly document: vscode.TextDocument,
    private readonly panel: vscode.WebviewPanel,
    private readonly host: SessionHost,
  ) {}

  get uri(): vscode.Uri {
    return this.document.uri;
  }

  /**
   * Asks the webview to send collected typing and resolves when it has been applied (or after a
   * timeout, if the webview does not answer). Used before save, undo, and redo.
   */
  flush(): Promise<void> {
    const token = this.nextFlushToken++;
    return new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        this.flushes.delete(token);
        resolve();
      }, FLUSH_TIMEOUT_MS);
      this.flushes.set(token, () => {
        clearTimeout(timer);
        resolve();
      });
      this.post({ type: "flush", token });
    });
  }

  receive(raw: unknown): Promise<void> {
    const message = parseWebviewMessage(raw);
    if (!message) {
      // Malformed or hostile messages are dropped without side effects (§15).
      return this.queue;
    }
    this.queue = this.queue.then(() => this.handle(message)).catch(() => undefined);
    return this.queue;
  }

  post(message: HostMessage): void {
    this.sent.push(message);
    if (this.sent.length > 200) {
      this.sent.shift();
    }
    void this.panel.webview.postMessage(message);
  }

  /** Shows the editor and moves its cursor to the start of `line`. */
  revealLine(line: number): void {
    this.panel.reveal(undefined, false);
    if (this.initialized) {
      this.post({ type: "reveal", line });
    } else {
      this.pendingReveal = line;
    }
  }

  /** Called for every change of the document. */
  documentChanged(event: vscode.TextDocumentChangeEvent): void {
    if (event.contentChanges.length === 0) {
      return;
    }
    const applying = this.applying;
    if (applying && event.document.version === applying.version + 1) {
      this.applying = undefined;
      this.lastAcknowledged = applying.id;
      this.post({ type: "ack", id: applying.id, version: event.document.version });
      return;
    }
    this.post({
      type: "update",
      version: event.document.version,
      changes: event.contentChanges.map((change) => ({
        from: { line: change.range.start.line, character: change.range.start.character },
        to: { line: change.range.end.line, character: change.range.end.character },
        text: change.text,
      })),
    });
  }

  private pageField(): { page?: PageLocation } {
    const page = this.host.pageLocation(this, this.panel.webview);
    return page ? { page } : {};
  }

  sendSettings(): void {
    this.post({ type: "settings", settings: readSettings(this.document) });
  }

  sendDiagnostics(): void {
    this.post({ type: "diagnostics", diagnostics: toDiagnostics(this.document.uri) });
  }

  private async handle(message: WebviewMessage): Promise<void> {
    switch (message.type) {
      case "ready":
        this.post({
          type: "init",
          version: this.document.version,
          text: this.document.getText(),
          settings: readSettings(this.document),
          labels: this.host.labels,
          ...this.pageField(),
        });
        this.initialized = true;
        this.sendDiagnostics();
        if (this.pendingReveal !== undefined) {
          this.post({ type: "reveal", line: this.pendingReveal });
          this.pendingReveal = undefined;
        }
        return;
      case "flushed":
        // Messages are processed in order, so every edit sent before this answer is applied.
        this.flushes.get(message.token)?.();
        this.flushes.delete(message.token);
        return;
      case "selection":
        this.position = { line: message.line, character: message.character };
        this.host.selectionChanged(this);
        return;
      case "request":
        // Not awaited: an action such as save waits for a flush that is queued behind it.
        void this.host.act(this, message.action);
        return;
      case "openLink":
        void this.host.openLink(this, message.target);
        return;
      case "insertLink":
        // Not awaited: the author answers quick picks while typing continues to arrive.
        void this.host.insertLink(this, message.selection);
        return;
      case "complete":
        void this.host.complete(this, message.id, message.anchorsOf);
        return;
      case "edit":
        await this.applyWebviewEdit(message);
        return;
    }
  }

  private async applyWebviewEdit(
    message: Extract<WebviewMessage, { type: "edit" }>,
  ): Promise<void> {
    if (message.baseVersion !== this.document.version) {
      this.post({ type: "reject", id: message.id });
      return;
    }
    const edit = new vscode.WorkspaceEdit();
    for (const change of message.changes) {
      const range = toRange(change);
      if (this.document.validateRange(range).isEqual(range)) {
        edit.replace(this.document.uri, range, change.text);
      } else {
        this.post({ type: "reject", id: message.id });
        return;
      }
    }
    this.applying = { id: message.id, version: this.document.version };
    const applied = await vscode.workspace.applyEdit(edit);
    this.applying = undefined;
    if (!applied) {
      this.post({ type: "reject", id: message.id });
    } else if (this.lastAcknowledged !== message.id) {
      // The edit did not change the text (for example, identical replacement): no change event.
      this.post({ type: "ack", id: message.id, version: this.document.version });
    }
  }
}

function webviewHtml(webview: vscode.Webview, extensionUri: vscode.Uri): string {
  const nonce = randomBytes(16).toString("base64");
  const script = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, "dist", "webview", "main.js"),
  );
  const style = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, "dist", "webview", "main.css"),
  );
  const csp = [
    "default-src 'none'",
    `style-src ${webview.cspSource} 'nonce-${nonce}'`,
    `script-src 'nonce-${nonce}'`,
    `font-src ${webview.cspSource}`,
    `img-src ${webview.cspSource}`,
    // The preview renders in a worker that the editor script starts from its own bundled code.
    "worker-src blob:",
  ].join("; ");
  return `<!DOCTYPE html>
<html lang="${vscode.env.language}">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="lorequill-nonce" content="${nonce}">
<link rel="stylesheet" href="${style.toString()}">
<title>Lorequill</title>
</head>
<body>
<div id="toolbar"></div>
<div id="editor"></div>
<script nonce="${nonce}" src="${script.toString()}"></script>
</body>
</html>`;
}

function untrustedHtml(translate: Translate): string {
  const text = translate("editor.untrusted").replace(
    /[&<>"]/g,
    (character) => `&#${String(character.charCodeAt(0))};`,
  );
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'"></head><body><p>${text}</p></body></html>`;
}

/**
 * The Lorequill page editor: a CodeMirror webview over the ordinary `TextDocument`, so native
 * save, undo, redo, Auto Save, hot exit, and **Reopen Editor With…** keep working (§7, §8).
 */
export class PageEditorProvider
  implements vscode.CustomTextEditorProvider, vscode.Disposable, SessionHost
{
  private readonly sessions = new Set<EditorSession>();
  private active: EditorSession | undefined;
  private readonly activeEmitter = new vscode.EventEmitter<void>();
  private readonly cursorEmitter = new vscode.EventEmitter<void>();
  /** Fires when another Lorequill editor becomes active, or none is active anymore. */
  readonly onDidChangeActivePage = this.activeEmitter.event;
  /** Fires when the cursor of the active Lorequill editor moves. */
  readonly onDidChangeCursor = this.cursorEmitter.event;
  private readonly subscriptions: vscode.Disposable[];
  private readonly positionItem: vscode.StatusBarItem;
  private readonly statsItem: vscode.StatusBarItem;
  private statsTimer: ReturnType<typeof setTimeout> | undefined;

  readonly labels: EditorLabels;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly translate: Translate,
    /** The content root that contains a page, if the page belongs to a ready folder. */
    private readonly contentRootOf: (uri: vscode.Uri) => vscode.Uri | undefined = () => undefined,
    private readonly links?: LinkService,
  ) {
    this.labels = readLabels(translate);
    // Status bar (§8): line and column, words and reading time, and the document save state.
    this.positionItem = vscode.window.createStatusBarItem(
      "lorequill.position",
      vscode.StatusBarAlignment.Right,
      100,
    );
    this.positionItem.name = "Lorequill";
    this.statsItem = vscode.window.createStatusBarItem(
      "lorequill.pageStats",
      vscode.StatusBarAlignment.Right,
      99,
    );
    this.statsItem.name = "Lorequill";
    this.subscriptions = [
      this.positionItem,
      this.statsItem,
      this.activeEmitter,
      this.cursorEmitter,
      vscode.workspace.onDidChangeTextDocument((event) => {
        for (const session of this.sessions) {
          if (session.uri.toString() === event.document.uri.toString()) {
            session.documentChanged(event);
          }
        }
        if (this.active?.uri.toString() === event.document.uri.toString()) {
          this.scheduleStats();
        }
      }),
      vscode.workspace.onDidSaveTextDocument((document) => {
        if (this.active?.uri.toString() === document.uri.toString()) {
          this.updateStats();
        }
      }),
      // Collected typing must reach the document before it is written (§7: Save writes the buffer).
      vscode.workspace.onWillSaveTextDocument((event) => {
        const sessions = [...this.sessions].filter(
          (session) => session.uri.toString() === event.document.uri.toString(),
        );
        if (sessions.length > 0) {
          event.waitUntil(Promise.all(sessions.map((session) => session.flush())));
        }
      }),
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (
          event.affectsConfiguration("editor") ||
          event.affectsConfiguration("lorequill.editor")
        ) {
          this.sessions.forEach((session) => {
            session.sendSettings();
          });
        }
      }),
      vscode.languages.onDidChangeDiagnostics((event) => {
        const changed = new Set(event.uris.map((uri) => uri.toString()));
        for (const session of this.sessions) {
          if (changed.has(session.uri.toString())) {
            session.sendDiagnostics();
          }
        }
      }),
    ];
  }

  resolveCustomTextEditor(document: vscode.TextDocument, panel: vscode.WebviewPanel): void {
    if (!vscode.workspace.isTrusted) {
      // Managed editing needs a trusted workspace (§15); the text editor stays available.
      panel.webview.options = { enableScripts: false };
      panel.webview.html = untrustedHtml(this.translate);
      return;
    }
    // Images of the rendered preview load from the page's workspace folder. The folder is known
    // when the editor is restored at startup, before the profile is loaded; the renderer itself
    // only produces image URIs inside the content root (§8).
    const folder = vscode.workspace.getWorkspaceFolder(document.uri)?.uri;
    panel.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this.extensionUri, "dist", "webview"),
        ...(folder ? [folder] : []),
      ],
    };
    const session = new EditorSession(document, panel, this);
    this.sessions.add(session);
    if (panel.active) {
      this.setActive(session);
    }
    const disposables = [
      panel.webview.onDidReceiveMessage((message: unknown) => {
        void session.receive(message);
      }),
      panel.onDidChangeViewState(() => {
        if (panel.active) {
          this.setActive(session);
        } else if (this.active === session) {
          this.setActive(undefined);
        }
      }),
    ];
    panel.onDidDispose(() => {
      this.sessions.delete(session);
      if (this.active === session) {
        this.setActive(undefined);
      }
      disposables.forEach((disposable) => {
        disposable.dispose();
      });
    });
    panel.webview.html = webviewHtml(panel.webview, this.extensionUri);
  }

  /** Opens find or replace, or switches the view mode, in the active Lorequill editor. */
  runCommand(command: EditorCommand): void {
    this.active?.post({ type: "command", command });
  }

  /** Undo or redo in the active Lorequill editor, after its collected typing has been applied. */
  async undoRedo(command: "undo" | "redo"): Promise<void> {
    await this.active?.flush();
    await vscode.commands.executeCommand(command);
  }

  async act(session: EditorSession, action: HostAction): Promise<void> {
    switch (action) {
      case "undo":
      case "redo":
        if (this.active === session) {
          await vscode.commands.executeCommand(action);
        }
        return;
      case "save":
        await session.document.save();
        return;
      case "checkPages":
        await vscode.commands.executeCommand("lorequill.checkPages");
        return;
      case "commit":
        await vscode.commands.executeCommand("lorequill.commit");
        return;
      case "submit":
        await vscode.commands.executeCommand("lorequill.submit");
        return;
      case "openAsText":
        await vscode.commands.executeCommand("vscode.openWith", session.uri, "default");
        return;
      case "showProperties":
        // VS Code contributes a focus command for every view.
        await vscode.commands.executeCommand("lorequill.properties.focus");
        return;
    }
  }

  /**
   * Opens the target of a Ctrl+clicked link (§8). The destination is resolved like the
   * `relative-links` check resolves it: relative to the page, inside the content root (or the
   * workspace folder for pages outside it). Pages open in the Lorequill editor and jump to the
   * heading of a fragment; other files open in VS Code; `http:`, `https:`, and `mailto:` links go
   * through VS Code's external opener with its link protection.
   */
  async openLink(session: EditorSession, target: string): Promise<void> {
    const root =
      this.contentRootOf(session.uri) ?? vscode.workspace.getWorkspaceFolder(session.uri)?.uri;
    const relative = root && pathInside(root, session.uri);
    const inside = root !== undefined && relative !== undefined && relative !== "";
    const base = inside ? root : vscode.Uri.joinPath(session.uri, "..");
    const sourcePath = inside ? relative : posix.basename(session.uri.path);
    const destination = resolveLinkDestination(sourcePath, target);
    switch (destination.kind) {
      case "external":
        await vscode.env.openExternal(vscode.Uri.parse(target, true));
        return;
      case "same-page":
        this.revealAnchor(session, destination.fragment);
        return;
      case "invalid":
        void vscode.window.showWarningMessage(
          this.translate("editor.link.unsupported", { target }),
        );
        return;
      case "path":
        break;
    }
    let uri = vscode.Uri.joinPath(base, ...destination.path.split("/"));
    try {
      if ((await vscode.workspace.fs.stat(uri)).type & vscode.FileType.Directory) {
        // A directory link opens its index page, as MkDocs serves it.
        uri = vscode.Uri.joinPath(uri, "index.md");
        await vscode.workspace.fs.stat(uri);
      }
    } catch {
      void vscode.window.showWarningMessage(this.translate("editor.link.notFound", { target }));
      return;
    }
    if (!uri.path.toLowerCase().endsWith(".md")) {
      await vscode.commands.executeCommand("vscode.open", uri);
      return;
    }
    await vscode.commands.executeCommand("vscode.openWith", uri, PAGE_EDITOR_VIEW_TYPE);
    const opened =
      this.active?.uri.toString() === uri.toString()
        ? this.active
        : [...this.sessions].find((candidate) => candidate.uri.toString() === uri.toString());
    if (opened && destination.fragment) {
      this.revealAnchor(opened, destination.fragment);
    }
  }

  pageLocation(session: EditorSession, webview: vscode.Webview): PageLocation | undefined {
    const root = this.contentRootOf(session.uri);
    if (!root) {
      return undefined;
    }
    const path = pathInside(root, session.uri);
    if (!path) {
      return undefined;
    }
    const base = webview.asWebviewUri(root).toString();
    return { path, resourceBase: base.endsWith("/") ? base : `${base}/` };
  }

  private revealAnchor(session: EditorSession, fragment: string): void {
    if (fragment === "") {
      session.revealLine(0);
      return;
    }
    const line = findAnchorLine(session.document.getText(), fragment);
    if (line === undefined) {
      void vscode.window.showWarningMessage(
        this.translate("editor.link.anchorNotFound", { anchor: fragment }),
      );
    } else {
      session.revealLine(line);
    }
  }

  selectionChanged(session: EditorSession): void {
    if (session === this.active) {
      this.updatePosition();
      this.cursorEmitter.fire();
    }
  }

  async insertLink(session: EditorSession, selection: string): Promise<void> {
    const link = await this.links?.pick(session.uri, selection);
    if (link) {
      session.post({ type: "insertLink", text: link.text, destination: link.destination });
    }
  }

  async complete(session: EditorSession, id: number, anchorsOf: string | undefined): Promise<void> {
    const items = (await this.links?.completions(session.uri, anchorsOf)) ?? [];
    session.post({ type: "completions", id, items: items.slice(0, LIMITS.maxCompletions) });
  }

  /** The document and cursor line of the active Lorequill editor, if one is active. */
  activePage(): { readonly document: vscode.TextDocument; readonly line: number } | undefined {
    return this.active && { document: this.active.document, line: this.active.position.line };
  }

  /** Moves the cursor of the active Lorequill editor to `line` and focuses it. */
  revealLine(line: number): void {
    this.active?.revealLine(line);
  }

  /** Open sessions, for integration tests. */
  probes(): readonly EditorSessionProbe[] {
    return [...this.sessions];
  }

  private setActive(session: EditorSession | undefined): void {
    if (this.active === session) {
      return;
    }
    this.active = session;
    this.activeEmitter.fire();
    if (session) {
      this.updatePosition();
      this.updateStats();
      this.positionItem.show();
      this.statsItem.show();
    } else {
      this.positionItem.hide();
      this.statsItem.hide();
    }
  }

  private updatePosition(): void {
    if (!this.active) {
      return;
    }
    const { line, character } = this.active.position;
    this.positionItem.text = this.translate("status.position", {
      line: line + 1,
      column: character + 1,
    });
  }

  private scheduleStats(): void {
    clearTimeout(this.statsTimer);
    this.statsTimer = setTimeout(() => {
      this.updateStats();
    }, 300);
  }

  private updateStats(): void {
    if (!this.active) {
      return;
    }
    const words = countWords(this.active.document.getText());
    const state = this.translate(this.active.document.isDirty ? "status.unsaved" : "status.saved");
    this.statsItem.text = `${this.translate("status.words", { words, minutes: readingMinutes(words) })} · ${state}`;
  }

  dispose(): void {
    clearTimeout(this.statsTimer);
    this.subscriptions.forEach((subscription) => {
      subscription.dispose();
    });
  }
}
