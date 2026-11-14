import { randomBytes } from "node:crypto";
import {
  PROPERTIES_LABEL_KEYS,
  parsePropertiesWebviewMessage,
  type PropertiesHostMessage,
  type PropertiesModel,
  type PropertiesWebviewMessage,
} from "@lorequill/editor";
import { updateFrontMatter, type FrontMatterIssue } from "@lorequill/markdown";
import type { Collection } from "@lorequill/profile";
import * as vscode from "vscode";
import type { MessageKey, Translate } from "../core/i18n";
import { planPropertyEdit, type PropertyRequest } from "../core/properties/edits";
import { buildPropertiesModel } from "../core/properties/model";
import type { FolderRegistry } from "../folders/folder-registry";
import { pathInside } from "../folders/uri-paths";

export const PROPERTIES_VIEW_ID = "lorequill.properties";

/** Waiting time after typing before the panel reads the front matter again. */
const REFRESH_DELAY_MS = 150;
/** Attempts to apply one property edit when the document changes in between. */
const MAX_ATTEMPTS = 3;

/** The page the panel shows: a document of a ready folder, included in its content scope. */
interface ActivePage {
  readonly uri: vscode.Uri;
  readonly path: string;
  readonly collections: readonly Collection[];
}

/**
 * The Properties view (`Properties`, specification §7, §8). It follows the active editor tab,
 * whether the page is open in the Lorequill editor or in the text editor, so it keeps its page
 * while the author works in the panel itself. Changes are planned against the current document
 * text and applied as a `WorkspaceEdit`: they join the document's undo history, and an edit that
 * meets a newer document version is computed again instead of overwriting newer text.
 */
export class PropertiesViewProvider implements vscode.WebviewViewProvider, vscode.Disposable {
  private view: vscode.WebviewView | undefined;
  private page: ActivePage | undefined;
  private readonly chosen = new Map<string, string>();
  private queue: Promise<void> = Promise.resolve();
  private refreshTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly subscriptions: vscode.Disposable[];
  /** Last model sent, for integration tests. */
  lastModel: PropertiesModel | undefined;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly registry: FolderRegistry,
    private readonly translate: Translate,
  ) {
    this.subscriptions = [
      vscode.window.tabGroups.onDidChangeTabs(() => {
        this.refresh();
      }),
      vscode.window.tabGroups.onDidChangeTabGroups(() => {
        this.refresh();
      }),
      registry.onDidChange(() => {
        this.refresh();
      }),
      vscode.workspace.onDidChangeTextDocument((event) => {
        if (event.document.uri.toString() === this.page?.uri.toString()) {
          clearTimeout(this.refreshTimer);
          this.refreshTimer = setTimeout(() => {
            this.refresh();
          }, REFRESH_DELAY_MS);
        }
      }),
    ];
  }

  dispose(): void {
    clearTimeout(this.refreshTimer);
    this.subscriptions.forEach((subscription) => {
      subscription.dispose();
    });
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, "dist", "webview")],
    };
    view.webview.html = this.html(view.webview);
    view.webview.onDidReceiveMessage((raw: unknown) => {
      const message = parsePropertiesWebviewMessage(raw);
      if (message) {
        this.queue = this.queue.then(() => this.receive(message));
      }
    });
    view.onDidChangeVisibility(() => {
      this.refresh();
    });
    view.onDidDispose(() => {
      this.view = undefined;
    });
  }

  /** The page of the active editor tab, if it is a page of a Lorequill folder. */
  private activePage(): ActivePage | undefined {
    const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
    const uri =
      input instanceof vscode.TabInputText || input instanceof vscode.TabInputCustom
        ? input.uri
        : undefined;
    if (!uri) {
      return undefined;
    }
    for (const model of this.registry.models()) {
      const root = model.contentRoot;
      if (model.status.kind !== "ready" || !root) {
        continue;
      }
      const path = pathInside(root, uri);
      if (!path) {
        continue;
      }
      if (model.pages.some((page) => page.path === path)) {
        return { uri, path, collections: model.status.profile.collections ?? [] };
      }
    }
    return undefined;
  }

  private async document(page: ActivePage): Promise<vscode.TextDocument> {
    return (
      vscode.workspace.textDocuments.find(
        (document) => document.uri.toString() === page.uri.toString(),
      ) ?? (await vscode.workspace.openTextDocument(page.uri))
    );
  }

  private model(page: ActivePage, text: string): PropertiesModel {
    const chosen = this.chosen.get(page.uri.toString());
    return buildPropertiesModel({
      collections: page.collections,
      pagePath: page.path,
      text,
      ...(chosen === undefined ? {} : { chosenCollection: chosen }),
      describeIssue: (issue) => this.describeIssue(issue),
    });
  }

  private describeIssue(issue: FrontMatterIssue): string {
    const message = this.translate(
      `frontmatter.issue.${issue.code}` as MessageKey,
      issue.params ?? {},
    );
    return issue.line === undefined
      ? message
      : this.translate("properties.problemAtLine", { line: issue.line, message });
  }

  /** Sends the model of the active page; nothing happens while the view is hidden. */
  refresh(): void {
    this.queue = this.queue.then(() => this.sendModel());
  }

  /** Waits until queued messages and refreshes are processed, for integration tests. */
  idle(): Promise<void> {
    return this.queue;
  }

  private async sendModel(): Promise<void> {
    this.page = this.activePage();
    if (!this.view?.visible) {
      return;
    }
    const page = this.page;
    const model: PropertiesModel = page
      ? this.model(page, (await this.document(page)).getText())
      : { status: "empty" };
    this.lastModel = model;
    await this.post({ type: "model", model });
  }

  private post(message: PropertiesHostMessage): Thenable<boolean> {
    return this.view?.webview.postMessage(message) ?? Promise.resolve(false);
  }

  private async receive(message: PropertiesWebviewMessage): Promise<void> {
    switch (message.type) {
      case "ready":
        await this.post({
          type: "labels",
          labels: Object.fromEntries(
            PROPERTIES_LABEL_KEYS.map((key) => [
              key,
              this.translate(`properties.label.${key}` as MessageKey),
            ]),
          ) as never,
        });
        await this.sendModel();
        return;
      case "chooseCollection":
        if (this.page) {
          this.chosen.set(this.page.uri.toString(), message.id);
        }
        await this.sendModel();
        return;
      case "openSource":
        if (this.page) {
          await vscode.commands.executeCommand("vscode.openWith", this.page.uri, "default");
        }
        return;
      case "set":
      case "insertDefault":
        await this.applyRequest(message);
        await this.sendModel();
        return;
    }
  }

  /** Applies one request; on a version conflict it is planned again against the new text. */
  async applyRequest(request: PropertyRequest): Promise<boolean> {
    const page = this.page ?? this.activePage();
    if (!page) {
      return false;
    }
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const document = await this.document(page);
      const version = document.version;
      const text = document.getText();
      const planned = planPropertyEdit(this.model(page, text), request);
      if (!planned.ok) {
        await this.notice(
          planned.reason === "stale"
            ? this.translate("properties.conflict")
            : this.translate("properties.failed", {
                reason: this.translate("properties.rejected"),
              }),
        );
        return false;
      }
      const result = updateFrontMatter(text, planned.edits);
      if (!result.ok) {
        const [issue] = result.issues;
        await this.notice(
          this.translate("properties.failed", {
            reason: issue ? this.describeIssue(issue) : "",
          }),
        );
        return false;
      }
      if (!result.changed) {
        return true;
      }
      const edit = new vscode.WorkspaceEdit();
      for (const change of result.edits) {
        edit.replace(
          document.uri,
          new vscode.Range(document.positionAt(change.start), document.positionAt(change.end)),
          change.newText,
        );
      }
      // `applyEdit` refuses edits computed for an older version, so newer text is never lost.
      if (document.version === version && (await vscode.workspace.applyEdit(edit))) {
        return true;
      }
    }
    await this.notice(this.translate("properties.conflict"));
    return false;
  }

  private async notice(message: string): Promise<void> {
    await this.post({ type: "notice", message });
  }

  private html(webview: vscode.Webview): string {
    const nonce = randomBytes(16).toString("base64");
    const base = vscode.Uri.joinPath(this.extensionUri, "dist", "webview");
    const script = webview.asWebviewUri(vscode.Uri.joinPath(base, "properties.js"));
    const style = webview.asWebviewUri(vscode.Uri.joinPath(base, "properties.css"));
    const csp = [
      "default-src 'none'",
      `style-src ${webview.cspSource}`,
      `script-src 'nonce-${nonce}'`,
    ].join("; ");
    return `<!DOCTYPE html>
<html lang="${vscode.env.language}">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="stylesheet" href="${style.toString()}">
</head>
<body>
<div id="properties"></div>
<script nonce="${nonce}" src="${script.toString()}"></script>
</body>
</html>`;
  }
}
