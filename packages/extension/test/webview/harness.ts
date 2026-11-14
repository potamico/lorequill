import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { EDITOR_LABEL_KEYS } from "@lorequill/editor";
import type { Locator, Page } from "@playwright/test";
import { en } from "../../src/core/i18n/en";

/**
 * Opens the built page editor webview in a test page with a simulated host. The host keeps the
 * document like VS Code: it applies the webview's edits when their base version matches,
 * answers with `ack` or `reject`, and can change the document from outside (as undo does).
 */

const dist = resolve(__dirname, "../../dist/webview");
// localhost is a secure context, so the clipboard API is available; nothing listens there,
// every request is answered by the route below.
const origin = "http://localhost:4173";

export const labels = Object.fromEntries(
  EDITOR_LABEL_KEYS.map((key) => [key, en[`editor.label.${key}`]]),
) as Record<(typeof EDITOR_LABEL_KEYS)[number], string>;

const page = (text: string): string => `<!DOCTYPE html>
<html><head><meta charset="UTF-8">
<meta name="lorequill-nonce" content="">
<link rel="stylesheet" href="${origin}/main.css">
<style>
  body { margin: 0; height: 100vh; display: flex; flex-direction: column;
    background: #1f1f1f; color: #cccccc; font-family: sans-serif;
    --vscode-editor-background: #1f1f1f; --vscode-foreground: #cccccc;
    --vscode-focusBorder: #0078d4; --vscode-widget-border: #454545;
    --vscode-editor-font-family: monospace; }
</style>
</head><body>
<div id="toolbar"></div><div id="editor"></div>
<script>
(() => {
  const host = { text: ${JSON.stringify(text)}, version: 1, requests: [] };
  window.lqHost = host;
  const send = (message) => setTimeout(() => window.postMessage(message, "*"), 0);
  const offset = (text, position) => {
    let index = 0;
    for (let line = 0; line < position.line; line++) {
      index = text.indexOf("\\n", index) + 1;
    }
    return index + position.character;
  };
  const position = (text, index) => {
    const before = text.slice(0, index).split("\\n");
    return { line: before.length - 1, character: before[before.length - 1].length };
  };
  host.replace = (from, to, insert) => {
    const change = { from: position(host.text, from), to: position(host.text, to), text: insert };
    host.text = host.text.slice(0, from) + insert + host.text.slice(to);
    host.version++;
    send({ type: "update", version: host.version, changes: [change] });
  };
  window.acquireVsCodeApi = () => ({
    getState: () => undefined,
    setState: () => {},
    postMessage: (message) => {
      if (message.type === "ready") {
        send({
          type: "init", version: host.version, text: host.text, labels: ${JSON.stringify(labels)},
          settings: { fontFamily: "monospace", fontSize: 14, tabSize: 4, wordWrap: true, maxTextWidth: 0 },
        });
      } else if (message.type === "edit") {
        if (message.baseVersion !== host.version) {
          send({ type: "reject", id: message.id });
          return;
        }
        let text = host.text;
        for (const change of [...message.changes].reverse()) {
          text = text.slice(0, offset(host.text, change.from)) + change.text +
            text.slice(offset(host.text, change.to));
        }
        host.text = text;
        host.version++;
        send({ type: "ack", id: message.id, version: host.version });
      } else if (message.type === "request") {
        host.requests.push(message.action);
      }
    },
  });
})();
</script>
<script src="${origin}/main.js"></script>
</body></html>`;

/** Opens the editor with `text` and waits until it shows it. */
export async function openEditor(target: Page, text: string): Promise<void> {
  await target.route(`${origin}/**`, async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/") {
      await route.fulfill({ contentType: "text/html", body: page(text) });
      return;
    }
    const file = resolve(dist, path.slice(1));
    if (!file.startsWith(dist)) {
      await route.abort();
      return;
    }
    const type = path.endsWith(".js")
      ? "text/javascript"
      : path.endsWith(".css")
        ? "text/css"
        : "font/ttf";
    await route.fulfill({ contentType: type, body: readFileSync(file) });
  });
  await target.goto(`${origin}/`);
  await target.locator(".cm-content").waitFor();
}

/**
 * The simulated host in the test page. The extension's sources have no DOM types, so the page's
 * globals are reached through `globalThis` with these narrow types.
 */
interface PageGlobals {
  readonly lqHost: {
    readonly text: string;
    replace(from: number, to: number, text: string): void;
  };
  readonly navigator: { readonly clipboard: { writeText(text: string): Promise<void> } };
  postMessage(message: unknown, targetOrigin: string): void;
}

/** The document as the host has it: what VS Code would save. */
export async function hostText(target: Page): Promise<string> {
  return target.evaluate(() => (globalThis as unknown as PageGlobals).lqHost.text);
}

/** Puts text on the clipboard of the test page. */
export async function writeClipboard(target: Page, text: string): Promise<void> {
  await target.evaluate(
    (value) => (globalThis as unknown as PageGlobals).navigator.clipboard.writeText(value),
    text,
  );
}

/** Changes the document from outside the webview, like undo in VS Code. */
export async function replaceInHost(
  target: Page,
  search: string,
  replacement: string,
): Promise<void> {
  await target.evaluate(
    ([find, insert]) => {
      const host = (globalThis as unknown as PageGlobals).lqHost;
      const from = host.text.indexOf(find);
      host.replace(from, from + find.length, insert);
    },
    [search, replacement] as const,
  );
}

/** A cell of the first table grid, by row (header 0) and column. */
export function cell(target: Page, row: number, column: number): Locator {
  return target.locator(".cm-lq-table tr").nth(row).locator("th, td").nth(column);
}

/** The input of the cell being edited. */
export function cellInput(target: Page): Locator {
  return target.locator("input.cm-lq-cell-input:focus");
}

/**
 * Sends an editor command as the host does when a VS Code command runs, for example from the
 * webview context menu or the command palette.
 */
export async function runCommand(target: Page, command: string): Promise<void> {
  await target.evaluate((name) => {
    (globalThis as unknown as PageGlobals).postMessage({ type: "command", command: name }, "*");
  }, command);
}
