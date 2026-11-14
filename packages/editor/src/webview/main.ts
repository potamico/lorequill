import "@vscode/codicons/dist/codicon.css";
import "./main.css";
import { defaultKeymap, indentLess, indentMore } from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { HighlightStyle, indentUnit, syntaxHighlighting } from "@codemirror/language";
import { setDiagnostics, type Diagnostic } from "@codemirror/lint";
import { openSearchPanel, search, searchKeymap } from "@codemirror/search";
import {
  Annotation,
  Compartment,
  EditorState,
  type Extension,
  type TransactionSpec,
} from "@codemirror/state";
import { drawSelection, EditorView, highlightActiveLine, keymap } from "@codemirror/view";
import { tags } from "@lezer/highlight";
import {
  insertHorizontalRule,
  insertPageLink,
  insertTable,
  toggleBlock,
  toggleCodeBlock,
  toggleInline,
} from "../formatting";
import {
  LIMITS,
  parseHostMessage,
  type EditorDiagnostic,
  type EditorLabelKey,
  type EditorLabels,
  type EditorSettings,
  type HostAction,
  type WebviewMessage,
} from "../protocol";
import { offsetOf, SyncClient, type ViewInstruction } from "../sync-client";
import { admonitionSyntax } from "../admonition-syntax";
import { codeHighlighter, codeLanguages } from "../code-languages";
import { linkTargetAt } from "../link-at";
import type { PreviewContext } from "../render";
import {
  buildAnchors,
  lineForTop,
  lineInBlock,
  offsetInBlock,
  topForLine,
  type BlockLines,
  type LineAnchor,
} from "../scroll-sync";
import { livePreview } from "./live-preview";
import { PreviewRenderer } from "./preview-renderer";
import { autoPair } from "./smart-input";
import { CompletionRequests, linkCompletion } from "./link-completion-source";

interface VsCodeApi {
  postMessage(message: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
}
declare function acquireVsCodeApi(): VsCodeApi;

/** Marks transactions that come from the host, so they are not sent back (no echo loop). */
const fromHost = Annotation.define<boolean>();

const vscode = acquireVsCodeApi();
const post = (message: WebviewMessage): void => {
  vscode.postMessage(message);
};
// Typing is grouped so that one VS Code undo step covers a phrase (§7 undo semantics).
const client = new SyncClient(post, { groupingDelayMs: 600, maxGroupMs: 3000 });

const settingsCompartment = new Compartment();
const previewCompartment = new Compartment();
let labels: EditorLabels | undefined;
let sourceMode = false;
let sourceButton: HTMLButtonElement | undefined;

/** View modes of §8: `Edit`, `Both`, and `Preview`. */
type ViewMode = "edit" | "both" | "view";
const VIEW_MODES: readonly ViewMode[] = ["edit", "both", "view"];
/** Below this width, `Both` falls back to `Edit` (§8). */
const MIN_BOTH_WIDTH = 640;
/** The chosen mode, remembered per editor in the webview state. */
let viewMode: ViewMode = restoreViewMode();
/** Whether live-preview decorations are currently configured. */
let livePreviewActive: boolean | undefined;
const modeButtons = new Map<ViewMode, HTMLButtonElement>();
/** Buttons that change the text; disabled while only the preview is visible. */
const editingButtons: HTMLButtonElement[] = [];
let pageContext: PreviewContext = {};

function restoreViewMode(): ViewMode {
  const state = vscode.getState();
  const mode =
    typeof state === "object" && state !== null && "viewMode" in state ? state.viewMode : undefined;
  return VIEW_MODES.find((candidate) => candidate === mode) ?? "edit";
}

// Colors come from the VS Code theme, so light, dark, and high-contrast themes work (§8). The
// code here only assigns classes; the look of Markdown elements and the reading layout of
// `Edit` are in `main.css`. The theme below maps CodeMirror's own parts to VS Code colors.

/** Marks link text and URLs, so that Ctrl+hover can underline them (`.cm-lq-follow`). */
const linkClass = HighlightStyle.define([{ tag: [tags.link, tags.url], class: "cm-lq-link" }]);

/** Markdown syntax as `lq-md-*` classes, styled in `main.css`. */
const highlight = HighlightStyle.define([
  { tag: tags.heading, class: "lq-md-heading" },
  { tag: tags.heading1, class: "lq-md-h1" },
  { tag: tags.heading2, class: "lq-md-h2" },
  { tag: tags.heading3, class: "lq-md-h3" },
  { tag: tags.heading4, class: "lq-md-h4" },
  { tag: tags.strong, class: "lq-md-strong" },
  { tag: tags.emphasis, class: "lq-md-emphasis" },
  { tag: tags.strikethrough, class: "lq-md-strikethrough" },
  { tag: [tags.link, tags.url], class: "lq-md-link" },
  { tag: tags.monospace, class: "lq-md-code" },
  { tag: [tags.processingInstruction, tags.meta], class: "lq-md-meta" },
  { tag: tags.quote, class: "lq-md-quote" },
]);

const theme = EditorView.theme({
  "&": {
    color: "var(--vscode-editor-foreground)",
    backgroundColor: "var(--vscode-editor-background)",
  },
  ".cm-scroller": {
    fontFamily: "var(--lorequill-font-family)",
    fontSize: "var(--lorequill-font-size)",
    lineHeight: "1.6",
  },
  ".cm-content": { caretColor: "var(--vscode-editorCursor-foreground)", padding: "16px 0" },
  ".cm-line": { padding: "0 24px" },
  "&.cm-focused": { outline: "none" },
  ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--vscode-editorCursor-foreground)" },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection": {
    backgroundColor: "var(--vscode-editor-selectionBackground)",
  },
  ".cm-activeLine": {
    backgroundColor: "var(--vscode-editor-lineHighlightBackground, transparent)",
  },
  ".cm-searchMatch": { backgroundColor: "var(--vscode-editor-findMatchHighlightBackground)" },
  ".cm-searchMatch-selected": { backgroundColor: "var(--vscode-editor-findMatchBackground)" },
  ".cm-panels": {
    backgroundColor: "var(--vscode-editorWidget-background)",
    color: "var(--vscode-editorWidget-foreground)",
  },
  ".cm-panels input, .cm-panels button": {
    color: "var(--vscode-input-foreground)",
    backgroundColor: "var(--vscode-input-background)",
    border: "1px solid var(--vscode-input-border, transparent)",
    fontFamily: "var(--vscode-font-family)",
  },
  ".cm-tooltip": {
    backgroundColor: "var(--vscode-editorHoverWidget-background)",
    color: "var(--vscode-editorHoverWidget-foreground)",
    border: "1px solid var(--vscode-editorHoverWidget-border)",
  },
  ".cm-lq-bullet": { color: "var(--vscode-descriptionForeground)" },
});

function settingsExtension(settings: EditorSettings): Extension {
  document.documentElement.style.setProperty("--lorequill-font-family", settings.fontFamily);
  document.documentElement.style.setProperty(
    "--lorequill-font-size",
    `${String(settings.fontSize)}px`,
  );
  document.documentElement.style.setProperty(
    "--lorequill-max-width",
    settings.maxTextWidth > 0 ? `${String(settings.maxTextWidth)}px` : "none",
  );
  return [
    EditorState.tabSize.of(settings.tabSize),
    indentUnit.of(" ".repeat(settings.tabSize)),
    settings.wordWrap ? EditorView.lineWrapping : [],
  ];
}

const nonce =
  document.querySelector<HTMLMetaElement>('meta[name="lorequill-nonce"]')?.content ?? "";

let selectionTimer: ReturnType<typeof setTimeout> | undefined;

/** Ctrl+click (Cmd+click on macOS) on a link asks the host to open its target (§8). */
/** Link completion asks the host; answers arrive as `completions` messages. */
const completions = new CompletionRequests((id, anchorsOf) => {
  post({ type: "complete", id, ...(anchorsOf === undefined ? {} : { anchorsOf }) });
});

const followLinks = [
  EditorView.domEventHandlers({
    mousedown(event, view) {
      if (event.button !== 0 || !(event.ctrlKey || event.metaKey)) {
        return false;
      }
      const position = view.posAtCoords({ x: event.clientX, y: event.clientY });
      const target = position === null ? undefined : linkTargetAt(view.state, position);
      if (!target) {
        return false;
      }
      event.preventDefault();
      client.flushNow();
      post({ type: "openLink", target });
      return true;
    },
    keydown(event, view) {
      view.dom.classList.toggle("cm-lq-follow", event.ctrlKey || event.metaKey);
      return false;
    },
    keyup(event, view) {
      view.dom.classList.toggle("cm-lq-follow", event.ctrlKey || event.metaKey);
      return false;
    },
    mousemove(event, view) {
      view.dom.classList.toggle("cm-lq-follow", event.ctrlKey || event.metaKey);
      return false;
    },
  }),
];

const view = new EditorView({
  parent: document.getElementById("editor") ?? document.body,
  state: EditorState.create({
    doc: "",
    extensions: [
      EditorView.cspNonce.of(nonce),
      // No CodeMirror history: undo and redo belong to the VS Code document (§7). The Markdown
      // keymap continues lists and quotes on Enter and ends them on an empty item (§8).
      // Fenced code blocks are parsed with the language named in their info string (§8).
      markdown({
        base: markdownLanguage,
        addKeymap: true,
        extensions: [admonitionSyntax],
        codeLanguages: codeLanguages(),
      }),
      keymap.of([
        ...searchKeymap,
        { key: "Tab", run: indentMore, shift: indentLess },
        ...defaultKeymap,
      ]),
      autoPair,
      linkCompletion(completions),
      drawSelection(),
      highlightActiveLine(),
      syntaxHighlighting(highlight),
      syntaxHighlighting(linkClass),
      syntaxHighlighting(codeHighlighter()),
      search({ top: true }),
      theme,
      settingsCompartment.of([]),
      previewCompartment.of([]),
      EditorView.contentAttributes.of({ "aria-label": "Markdown" }),
      followLinks,
      EditorView.updateListener.of((update) => {
        for (const transaction of update.transactions) {
          if (transaction.docChanged && !transaction.annotation(fromHost)) {
            const typing =
              transaction.isUserEvent("input.type") || transaction.isUserEvent("delete");
            client.local(transaction.changes, typing);
          }
        }
        if (update.docChanged) {
          schedulePreview();
        }
        if (update.selectionSet || update.docChanged) {
          clearTimeout(selectionTimer);
          selectionTimer = setTimeout(() => {
            const head = view.state.selection.main.head;
            const line = view.state.doc.lineAt(head);
            post({ type: "selection", line: line.number - 1, character: head - line.from });
          }, 100);
        }
        if (update.focusChanged && !update.view.hasFocus) {
          client.flushNow();
        }
      }),
    ],
  }),
});

// The rendered preview of `Both` and `Preview` sits beside the editor (§8).
const workspace = document.createElement("div");
workspace.id = "workspace";
view.dom.parentElement?.replaceWith(workspace);
const editorElement = document.createElement("div");
editorElement.id = "editor";
editorElement.append(view.dom);
const previewElement = document.createElement("div");
previewElement.id = "preview";
previewElement.tabIndex = 0;
const approximation = document.createElement("p");
approximation.className = "lq-approximation";
const previewBody = document.createElement("div");
previewBody.className = "lq-preview-body";
previewElement.append(approximation, previewBody);
workspace.append(editorElement, previewElement);

function effectiveMode(): ViewMode {
  return viewMode === "both" && document.body.clientWidth < MIN_BOTH_WIDTH ? "edit" : viewMode;
}

function setSourceMode(enabled: boolean): void {
  sourceMode = enabled;
  sourceButton?.setAttribute("aria-pressed", String(enabled));
  applyMode();
}

function setViewMode(mode: ViewMode): void {
  viewMode = mode;
  vscode.setState({ viewMode: mode });
  applyMode();
}

/**
 * Shows the chosen mode. Switching never touches the document (AT 51): only decorations, the
 * visibility of editor and preview, and the preview's content change.
 */
function applyMode(): void {
  const mode = effectiveMode();
  document.body.dataset.mode = mode;
  // `Both` shows the same editor as `Edit` beside the preview; `Source` applies to both.
  const live = mode !== "view" && !sourceMode;
  if (live !== livePreviewActive) {
    livePreviewActive = live;
    view.dispatch({
      effects: previewCompartment.reconfigure(
        live
          ? livePreview(
              labels?.frontMatter ?? "Front Matter",
              () => {
                // The compact properties line reveals the Properties view (§8).
                post({ type: "request", action: "showProperties" });
              },
              followPreviewLink,
            )
          : [],
      ),
    });
  }
  for (const [candidate, button] of modeButtons) {
    button.setAttribute("aria-pressed", String(candidate === viewMode));
  }
  for (const button of editingButtons) {
    button.disabled = mode === "view";
  }
  if (sourceButton) {
    sourceButton.disabled = mode === "view";
  }
  if (mode !== "edit") {
    renderNow();
    if (mode === "both") {
      whenPreviewReady(() => {
        syncFrom("editor");
      });
    }
  }
}

let previewDirty = true;
let previewTimer: ReturnType<typeof setTimeout> | undefined;
let anchorCache: LineAnchor[] | undefined;

/** Renders the preview after a typing pause, and only while it is visible. */
function schedulePreview(): void {
  previewDirty = true;
  if (effectiveMode() === "edit") {
    return;
  }
  clearTimeout(previewTimer);
  previewTimer = setTimeout(renderNow, 250);
}

function renderNow(): void {
  clearTimeout(previewTimer);
  if (!previewDirty) {
    return;
  }
  previewDirty = false;
  renderer.render(view.state.doc.toString(), pageContext);
}

/** Actions that need the rendered preview of the current text, such as scrolling to a line. */
let afterRender: (() => void)[] = [];

const renderer = new PreviewRenderer((html) => {
  // The HTML comes from the sanitizing renderer; page content is never inserted unescaped.
  previewBody.innerHTML = html;
  restoreTabs();
  anchorCache = undefined;
  if (!renderer.busy && !previewDirty) {
    const actions = afterRender;
    afterRender = [];
    for (const action of actions) {
      action();
    }
  }
});

/** Runs `action` once the preview shows the current text: now, or when the render arrives. */
function whenPreviewReady(action: () => void): void {
  renderNow();
  if (renderer.busy) {
    afterRender.push(action);
  } else {
    action();
  }
}

/** The tab chosen in each tab group (by group order), kept while the page is re-rendered. */
const chosenTabs = new Map<number, number>();

function tabGroups(): HTMLElement[] {
  return Array.from(previewBody.querySelectorAll<HTMLElement>(".lq-tabs"));
}

/** Shows tab `index` of `group`: label and panel are found by position. */
function selectTab(group: HTMLElement, index: number): void {
  const labels = group.querySelectorAll<HTMLElement>(":scope > .lq-tab-bar > .lq-tab-label");
  const panels = group.querySelectorAll<HTMLElement>(":scope > .lq-tab");
  if (index < 0 || index >= labels.length) {
    return;
  }
  labels.forEach((label, position) => {
    const active = position === index;
    label.classList.toggle("lq-tab-active", active);
    label.setAttribute("aria-selected", String(active));
    label.tabIndex = active ? 0 : -1;
  });
  panels.forEach((panel, position) => {
    panel.classList.toggle("lq-tab-active", position === index);
  });
  anchorCache = undefined;
}

function restoreTabs(): void {
  tabGroups().forEach((group, position) => {
    const chosen = chosenTabs.get(position);
    if (chosen !== undefined) {
      selectTab(group, chosen);
    }
  });
}

/** Switches to the clicked tab, or with the arrow keys to the neighbouring one; true if handled. */
function handleTabEvent(event: Event): boolean {
  const label = event.target instanceof Element ? event.target.closest(".lq-tab-label") : null;
  const bar = label?.parentElement;
  const group = bar?.parentElement;
  if (!(label instanceof HTMLElement) || !bar || !group?.classList.contains("lq-tabs")) {
    return false;
  }
  const labels = Array.from(bar.children);
  let index = labels.indexOf(label);
  if (event instanceof KeyboardEvent) {
    if (event.key === "ArrowRight") {
      index = (index + 1) % labels.length;
    } else if (event.key === "ArrowLeft") {
      index = (index - 1 + labels.length) % labels.length;
    } else if (event.key !== "Enter" && event.key !== " ") {
      return false;
    }
  }
  selectTab(group, index);
  chosenTabs.set(tabGroups().indexOf(group), index);
  (labels[index] as HTMLElement | undefined)?.focus();
  return true;
}

/** Positions of the preview's blocks, measured once per render or resize. */
function previewAnchors(): LineAnchor[] {
  if (!anchorCache) {
    const origin = previewElement.getBoundingClientRect().top - previewElement.scrollTop;
    const blocks: LineAnchor[] = [];
    for (const element of previewBody.querySelectorAll<HTMLElement>("[data-line]")) {
      // Blocks in hidden tabs have no position.
      if (element.getClientRects().length === 0) {
        continue;
      }
      blocks.push({
        line: Number(element.dataset.line),
        top: element.getBoundingClientRect().top - origin,
      });
    }
    anchorCache = buildAnchors(blocks, view.state.doc.lines, previewElement.scrollHeight);
  }
  return anchorCache;
}

/** The source lines of an editor block (see `BlockLines`). */
function blockLines(block: { from: number; to: number }): BlockLines {
  const doc = view.state.doc;
  const first = doc.lineAt(block.from).number - 1;
  return { first, count: doc.lineAt(block.to).number - first };
}

/** The fractional source line (0-based) at the top of the editor's viewport. */
function editorTopLine(): number {
  const height = view.scrollDOM.getBoundingClientRect().top - view.documentTop;
  const block = view.lineBlockAtHeight(Math.max(0, height));
  return lineInBlock(blockLines(block), block.height > 0 ? (height - block.top) / block.height : 0);
}

function scrollEditorToLine(line: number): void {
  const doc = view.state.doc;
  const whole = Math.min(Math.max(Math.floor(line), 0), doc.lines - 1);
  const block = view.lineBlockAt(doc.line(whole + 1).from);
  const documentStart =
    view.documentTop - view.scrollDOM.getBoundingClientRect().top + view.scrollDOM.scrollTop;
  view.scrollDOM.scrollTop =
    documentStart + block.top + offsetInBlock(blockLines(block), line) * block.height;
}

/** The side whose scroll position was just set by synchronization, to ignore its echo. */
let syncLock: { side: "editor" | "preview"; until: number } | undefined;
let syncFrame: number | undefined;

/** Aligns the other side with `side` in `Both` (§8, AT 56). */
function syncFrom(side: "editor" | "preview"): void {
  if (effectiveMode() !== "both") {
    return;
  }
  if (syncLock?.side === side && performance.now() < syncLock.until) {
    return;
  }
  if (syncFrame !== undefined) {
    cancelAnimationFrame(syncFrame);
  }
  syncFrame = requestAnimationFrame(() => {
    syncFrame = undefined;
    const anchors = previewAnchors();
    if (side === "editor") {
      syncLock = { side: "preview", until: performance.now() + 100 };
      previewElement.scrollTop = topForLine(anchors, editorTopLine());
    } else {
      syncLock = { side: "editor", until: performance.now() + 100 };
      scrollEditorToLine(lineForTop(anchors, previewElement.scrollTop));
    }
  });
}

view.scrollDOM.addEventListener("scroll", () => {
  syncFrom("editor");
});
previewElement.addEventListener("scroll", () => {
  syncFrom("preview");
});
// Opening or closing a collapsible block moves everything below it.
previewBody.addEventListener(
  "toggle",
  () => {
    anchorCache = undefined;
  },
  true,
);
new ResizeObserver(() => {
  anchorCache = undefined;
  if ((document.body.dataset.mode ?? "edit") !== effectiveMode()) {
    applyMode();
  }
}).observe(document.body);

/** Insert Link (§10): the host lets the author choose a page and answers with `insertLink`. */
function requestInsertLink(): void {
  const { from, to } = view.state.selection.main;
  client.flushNow();
  post({
    type: "insertLink",
    selection: view.state.sliceDoc(from, Math.min(to, from + LIMITS.maxLinkText)),
  });
}

/** A link in the preview opens like a Ctrl+clicked link in the editor (§8). */
function followPreviewLink(target: string): void {
  if (target.startsWith("#")) {
    let id: string;
    try {
      id = `user-content-${decodeURIComponent(target.slice(1))}`;
    } catch {
      id = "";
    }
    // Footnotes live only in the preview; everything else is resolved by the host.
    const local = id === "" ? null : document.getElementById(id);
    if (local && previewBody.contains(local)) {
      local.scrollIntoView({ block: "center" });
      return;
    }
  }
  let control = false;
  for (let index = 0; index < target.length; index++) {
    const code = target.charCodeAt(index);
    control ||= code < 0x20 || code === 0x7f;
  }
  // The host validates the same way; an invalid target is not sent at all.
  if (target.length <= LIMITS.maxLinkTarget && !control) {
    client.flushNow();
    post({ type: "openLink", target });
  }
}

function previewLinkTarget(event: Event): string | undefined {
  const element = event.target instanceof Element ? event.target.closest("[data-lq-href]") : null;
  return element instanceof HTMLElement ? element.dataset.lqHref : undefined;
}

previewBody.addEventListener("click", (event) => {
  if (handleTabEvent(event)) {
    event.preventDefault();
    return;
  }
  const target = previewLinkTarget(event);
  if (target !== undefined) {
    event.preventDefault();
    followPreviewLink(target);
  }
});
previewBody.addEventListener("keydown", (event) => {
  if (handleTabEvent(event)) {
    event.preventDefault();
    return;
  }
  const target = event.key === "Enter" ? previewLinkTarget(event) : undefined;
  if (target !== undefined) {
    event.preventDefault();
    followPreviewLink(target);
  }
});

/** Shows `line` at the top of whatever is visible (outline navigation, links to headings). */
function revealInPreview(line: number): void {
  if (effectiveMode() !== "edit") {
    whenPreviewReady(() => {
      syncLock = { side: "preview", until: performance.now() + 100 };
      previewElement.scrollTop = topForLine(previewAnchors(), line);
    });
  }
}

function format(command: (state: EditorState) => TransactionSpec | undefined): void {
  const spec = command(view.state);
  if (spec) {
    view.dispatch(spec);
  }
  view.focus();
}

function request(action: HostAction): void {
  // Collected typing goes first, so the host acts on the complete text.
  client.flushNow();
  post({ type: "request", action });
}

interface ButtonSpec {
  readonly label: EditorLabelKey;
  readonly icon?: string;
  readonly text?: string;
  readonly run: () => void;
}

function makeButton(spec: ButtonSpec, texts: EditorLabels): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "lq-button";
  button.title = texts[spec.label];
  button.setAttribute("aria-label", texts[spec.label]);
  if (spec.icon) {
    const icon = document.createElement("span");
    icon.className = `codicon codicon-${spec.icon}`;
    icon.setAttribute("aria-hidden", "true");
    button.append(icon);
  } else {
    button.textContent = spec.text ?? "";
    button.classList.add("lq-text-button");
  }
  // Keep the editor selection: do not move focus on mouse down.
  button.addEventListener("mousedown", (event) => {
    event.preventDefault();
  });
  button.addEventListener("click", spec.run);
  return button;
}

/** The writing toolbar (§8): grouped buttons, icons from codicons, labels localized. */
function buildToolbar(texts: EditorLabels): void {
  const toolbar = document.getElementById("toolbar");
  if (!toolbar) {
    return;
  }
  toolbar.replaceChildren();
  toolbar.setAttribute("role", "toolbar");
  toolbar.setAttribute("aria-label", texts.toolbar);
  const inline = (kind: "bold" | "italic" | "strikethrough" | "code") => () => {
    format((state) => toggleInline(state, kind));
  };
  const block =
    (kind: "heading1" | "heading2" | "heading3" | "bullet" | "numbered" | "task" | "quote") =>
    () => {
      format((state) => toggleBlock(state, kind));
    };
  const groups: readonly (readonly ButtonSpec[])[] = [
    [
      {
        label: "undo",
        icon: "discard",
        run: () => {
          request("undo");
        },
      },
      {
        label: "redo",
        icon: "redo",
        run: () => {
          request("redo");
        },
      },
    ],
    [
      { label: "bold", icon: "bold", run: inline("bold") },
      { label: "italic", icon: "italic", run: inline("italic") },
      { label: "strikethrough", icon: "strikethrough", run: inline("strikethrough") },
    ],
    [
      { label: "heading1", text: "H1", run: block("heading1") },
      { label: "heading2", text: "H2", run: block("heading2") },
      { label: "heading3", text: "H3", run: block("heading3") },
    ],
    [
      { label: "code", icon: "code", run: inline("code") },
      {
        label: "codeBlock",
        icon: "file-code",
        run: () => {
          format(toggleCodeBlock);
        },
      },
      { label: "quote", icon: "quote", run: block("quote") },
    ],
    [
      { label: "bullet", icon: "list-unordered", run: block("bullet") },
      { label: "numbered", icon: "list-ordered", run: block("numbered") },
      { label: "task", icon: "tasklist", run: block("task") },
    ],
    [
      {
        label: "link",
        icon: "link",
        run: requestInsertLink,
      },
      {
        label: "table",
        icon: "table",
        run: () => {
          format((state) => insertTable(state, [texts.tableHeader1, texts.tableHeader2]));
        },
      },
      {
        label: "horizontalRule",
        icon: "horizontal-rule",
        run: () => {
          format(insertHorizontalRule);
        },
      },
    ],
  ];
  groups.forEach((group, index) => {
    const element = document.createElement("div");
    element.className = "lq-group";
    element.setAttribute("role", "group");
    group.forEach((spec) => {
      const button = makeButton(spec, texts);
      // Undo and redo stay available; the formatting groups need the visible editor.
      if (index > 0) {
        editingButtons.push(button);
      }
      element.append(button);
    });
    toolbar.append(element);
  });
  const spacer = document.createElement("div");
  spacer.className = "lq-spacer";
  toolbar.append(spacer);

  // Segmented view-mode control (§8).
  const modes = document.createElement("div");
  modes.className = "lq-group lq-segmented";
  modes.setAttribute("role", "group");
  modes.setAttribute("aria-label", texts.viewModes);
  const modeLabels: Record<ViewMode, EditorLabelKey> = {
    edit: "viewEdit",
    both: "viewBoth",
    view: "viewPreview",
  };
  for (const mode of VIEW_MODES) {
    const button = makeButton(
      {
        label: modeLabels[mode],
        text: texts[modeLabels[mode]],
        run: () => {
          setViewMode(mode);
        },
      },
      texts,
    );
    modeButtons.set(mode, button);
    modes.append(button);
  }
  toolbar.append(modes);

  const endGroup = document.createElement("div");
  endGroup.className = "lq-group";
  sourceButton = makeButton(
    {
      label: "source",
      icon: "markdown",
      run: () => {
        setSourceMode(!sourceMode);
      },
    },
    texts,
  );
  sourceButton.setAttribute("aria-pressed", String(sourceMode));
  endGroup.append(
    sourceButton,
    makeButton(
      {
        label: "save",
        icon: "save",
        run: () => {
          request("save");
        },
      },
      texts,
    ),
    makeButton(
      {
        label: "checkPages",
        icon: "checklist",
        run: () => {
          request("checkPages");
        },
      },
      texts,
    ),
    makeButton(
      {
        label: "commit",
        icon: "git-commit",
        run: () => {
          request("commit");
        },
      },
      texts,
    ),
    makeButton(
      {
        label: "submit",
        icon: "git-pull-request-create",
        run: () => {
          request("submit");
        },
      },
      texts,
    ),
  );
  toolbar.append(endGroup);
}

function follow(instruction: ViewInstruction): void {
  if (instruction.kind === "apply") {
    view.dispatch({ changes: instruction.changes, annotations: fromHost.of(true) });
  } else if (instruction.kind === "reset") {
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: instruction.text },
      annotations: fromHost.of(true),
    });
  }
}

function showDiagnostics(diagnostics: readonly EditorDiagnostic[]): void {
  const doc = view.state.doc;
  const converted: Diagnostic[] = [];
  for (const diagnostic of diagnostics) {
    const from = offsetOf(doc, diagnostic.from);
    const to = offsetOf(doc, diagnostic.to);
    if (from !== undefined && to !== undefined && from <= to) {
      converted.push({
        from,
        to,
        severity: diagnostic.severity,
        message: diagnostic.message,
        ...(diagnostic.source === undefined ? {} : { source: diagnostic.source }),
      });
    }
  }
  view.dispatch(setDiagnostics(view.state, converted));
}

window.addEventListener("message", (event: MessageEvent) => {
  const message = parseHostMessage(event.data);
  if (!message) {
    return;
  }
  switch (message.type) {
    case "init":
      if (!labels) {
        labels = message.labels;
        buildToolbar(message.labels);
        approximation.textContent = message.labels.previewApproximation;
        previewElement.setAttribute("aria-label", message.labels.viewPreview);
      }
      pageContext = message.page
        ? { pagePath: message.page.path, resourceBase: message.page.resourceBase }
        : {};
      previewDirty = true;
      view.dispatch({
        effects: settingsCompartment.reconfigure(settingsExtension(message.settings)),
      });
      follow(client.init(message.version, message.text));
      livePreviewActive = undefined;
      applyMode();
      break;
    case "update":
      follow(client.update(message.version, message.changes));
      break;
    case "ack":
      follow(client.ack(message.id, message.version));
      break;
    case "reject":
      follow(client.reject(message.id));
      break;
    case "settings":
      view.dispatch({
        effects: settingsCompartment.reconfigure(settingsExtension(message.settings)),
      });
      break;
    case "diagnostics":
      showDiagnostics(message.diagnostics);
      break;
    case "insertLink":
      if (effectiveMode() === "view") {
        setViewMode("edit");
      }
      format((state) => insertPageLink(state, message.text, message.destination));
      break;
    case "completions":
      completions.answer(message.id, message.items);
      break;
    case "command":
      if (message.command === "insertLink") {
        requestInsertLink();
      } else if (message.command === "viewEdit") {
        setViewMode("edit");
      } else if (message.command === "viewBoth") {
        setViewMode("both");
      } else if (message.command === "viewPreview") {
        setViewMode("view");
      } else {
        // Find and replace work on the source, so `Preview` switches to editing first.
        if (effectiveMode() === "view") {
          setViewMode("edit");
        }
        openSearchPanel(view);
        if (message.command === "replace") {
          view.dom.querySelector<HTMLInputElement>(".cm-search input[name=replace]")?.focus();
        }
      }
      break;
    case "reveal": {
      // The host counts lines in its document, which may lag behind unsent typing by a few
      // characters, so the line is clamped instead of trusted.
      const line = view.state.doc.line(Math.min(message.line + 1, view.state.doc.lines));
      view.dispatch({
        selection: { anchor: line.from },
        effects: EditorView.scrollIntoView(line.from, { y: "start", yMargin: 16 }),
      });
      revealInPreview(line.number - 1);
      if (effectiveMode() === "view") {
        previewElement.focus();
      } else {
        view.focus();
      }
      break;
    }
    case "flush":
      client.flushNow();
      post({ type: "flushed", token: message.token });
      break;
  }
});

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") {
    client.flushNow();
  }
});

client.resync();
view.focus();
