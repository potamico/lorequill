import { syntaxTree } from "@codemirror/language";
import { RangeSetBuilder, StateField, type EditorState, type Range } from "@codemirror/state";
import {
  Decoration,
  EditorView,
  ViewPlugin,
  WidgetType,
  type DecorationSet,
  type ViewUpdate,
} from "@codemirror/view";
import { findFrontMatter } from "@lorequill/markdown/front-matter";
import {
  ADMONITION_ICONS,
  readAdmonitionHeader,
  type AdmonitionHeader,
} from "../admonition-syntax";
import { toggleTask } from "../formatting";
import { findTables, type TableBlock } from "../table-grid";
import { enterTable, TableGridWidget } from "./table-grid-view";

/**
 * Basic live-preview decorations (specification §8): Markdown syntax of headings, emphasis,
 * strikethrough, inline code, and links is hidden unless the cursor or selection is on it; bullet
 * markers are shown as bullets; quote markers, horizontal rules, and code fences are hidden
 * outside the cursor; headings, lists, quotes, and code blocks get line classes for the reading
 * layout; tables are shown as editable grids; the front matter is hidden behind a
 * compact line. Decorations only change the display:
 * the document text is never modified.
 */

function touches(state: EditorState, from: number, to: number): boolean {
  return state.selection.ranges.some((range) => range.from <= to && range.to >= from);
}

/** Whether a non-empty selection covers part of the range. */
function selects(state: EditorState, from: number, to: number): boolean {
  return state.selection.ranges.some(
    (range) => !range.empty && range.from <= to && range.to >= from,
  );
}

function onCursorLine(state: EditorState, from: number, to: number): boolean {
  const first = state.doc.lineAt(from).number;
  const last = state.doc.lineAt(to).number;
  return state.selection.ranges.some((range) => {
    const line = state.doc.lineAt(range.head).number;
    return line >= first && line <= last;
  });
}

class HorizontalRuleWidget extends WidgetType {
  override eq(): boolean {
    return true;
  }
  toDOM(): HTMLElement {
    const rule = document.createElement("span");
    rule.className = "cm-lq-hr";
    return rule;
  }
}

class AdmonitionTitleWidget extends WidgetType {
  constructor(private readonly header: AdmonitionHeader) {
    super();
  }
  override eq(other: AdmonitionTitleWidget): boolean {
    return (
      other.header.title === this.header.title &&
      other.header.family === this.header.family &&
      other.header.collapsible === this.header.collapsible
    );
  }
  toDOM(): HTMLElement {
    const title = document.createElement("span");
    title.className = "cm-lq-adm-heading";
    const icon = document.createElement("span");
    icon.className = `codicon codicon-${ADMONITION_ICONS[this.header.family] ?? "edit"}`;
    icon.setAttribute("aria-hidden", "true");
    const text = document.createElement("span");
    text.textContent = this.header.title;
    title.append(icon, text);
    if (this.header.collapsible) {
      const chevron = document.createElement("span");
      chevron.className = `codicon codicon-chevron-${this.header.marker === "???+" ? "down" : "right"} cm-lq-adm-chevron`;
      chevron.setAttribute("aria-hidden", "true");
      title.append(chevron);
    }
    return title;
  }
}

/** A task-list checkbox; clicking it toggles the marker in the text (one undoable edit). */
class CheckboxWidget extends WidgetType {
  constructor(private readonly checked: boolean) {
    super();
  }
  override eq(other: CheckboxWidget): boolean {
    return other.checked === this.checked;
  }
  toDOM(view: EditorView): HTMLElement {
    const box = document.createElement("input");
    box.type = "checkbox";
    box.className = "cm-lq-task";
    box.checked = this.checked;
    box.addEventListener("mousedown", (event) => {
      // Keep the cursor where it is, so the widget stays visible while toggling.
      event.preventDefault();
      const spec = toggleTask(view.state, view.posAtDOM(box));
      if (spec) {
        view.dispatch(spec);
      }
    });
    box.addEventListener("click", (event) => {
      event.preventDefault();
    });
    return box;
  }
  override ignoreEvent(): boolean {
    return true;
  }
}

class BulletWidget extends WidgetType {
  override eq(): boolean {
    return true;
  }
  toDOM(): HTMLElement {
    const bullet = document.createElement("span");
    bullet.className = "cm-lq-bullet";
    bullet.textContent = "•";
    return bullet;
  }
}

const hidden = Decoration.replace({});
const bullet = Decoration.replace({ widget: new BulletWidget() });
const horizontalRule = Decoration.replace({ widget: new HorizontalRuleWidget() });
const inlineCode = Decoration.mark({ class: "cm-lq-inline-code" });
const quoteLine = Decoration.line({ class: "cm-lq-quote" });
const listLine = Decoration.line({ class: "cm-lq-list" });
const blankLine = Decoration.line({ class: "cm-lq-blank" });
const codeInfo = Decoration.mark({ class: "cm-lq-code-info" });
const fenceEnd = Decoration.line({ class: "cm-lq-fence-end" });
const checkboxes = [false, true].map((checked) =>
  Decoration.replace({ widget: new CheckboxWidget(checked) }),
);

/**
 * Decorates an admonition: a colored box over its lines (up to the last line with content), the
 * marker replaced by an icon and title outside the cursor line, and the body indentation hidden.
 */
function decorateAdmonition(
  state: EditorState,
  decorations: Range<Decoration>[],
  from: number,
  to: number,
  markFrom: number,
  markTo: number,
): void {
  const header = readAdmonitionHeader(state.sliceDoc(markFrom, markTo));
  if (!header) {
    return;
  }
  const first = state.doc.lineAt(from);
  let last = state.doc.lineAt(to);
  while (last.number > first.number && last.text.trim() === "") {
    last = state.doc.line(last.number - 1);
  }
  const markerIndent = markFrom - first.from;
  for (let number = first.number; number <= last.number; number++) {
    const line = state.doc.line(number);
    const classes = ["cm-lq-adm", `cm-lq-adm-${header.family}`];
    if (number === first.number) {
      classes.push("cm-lq-adm-title");
    }
    if (number === last.number) {
      classes.push("cm-lq-adm-last");
    }
    decorations.push(Decoration.line({ class: classes.join(" ") }).range(line.from));
    if (number > first.number && !onCursorLine(state, line.from, line.to)) {
      const indentFrom = line.from + markerIndent;
      const indentTo = indentFrom + 4;
      if (indentTo <= line.to && state.sliceDoc(indentFrom, indentTo) === "    ") {
        decorations.push(hidden.range(indentFrom, indentTo));
      }
    }
  }
  if (!onCursorLine(state, markFrom, markTo)) {
    decorations.push(
      Decoration.replace({ widget: new AdmonitionTitleWidget(header) }).range(markFrom, markTo),
    );
  }
}
const headingLines = [1, 2, 3, 4, 5, 6].map((level) =>
  Decoration.line({ class: `cm-lq-heading cm-lq-h${String(level)}` }),
);

/** Adds a line decoration to every line from `from` to `to`. */
function decorateLines(
  state: EditorState,
  decorations: Range<Decoration>[],
  from: number,
  to: number,
  decoration: (index: number, count: number) => Decoration,
): void {
  const first = state.doc.lineAt(from).number;
  const last = state.doc.lineAt(to).number;
  for (let line = first; line <= last; line++) {
    decorations.push(decoration(line - first, last - first + 1).range(state.doc.line(line).from));
  }
}

const codeLines = new Map<string, Decoration>();
/** A line of a fenced code block; the first and last line get rounded corners. */
function codeLine(index: number, count: number): Decoration {
  const classes = ["cm-lq-code-block"];
  if (index === 0) {
    classes.push("cm-lq-code-first");
  }
  if (index === count - 1) {
    classes.push("cm-lq-code-last");
  }
  const key = classes.join(" ");
  let decoration = codeLines.get(key);
  if (!decoration) {
    decoration = Decoration.line({ class: key });
    codeLines.set(key, decoration);
  }
  return decoration;
}

const INLINE_CONTAINERS = new Set([
  "Emphasis",
  "StrongEmphasis",
  "Strikethrough",
  "InlineCode",
  "Link",
]);
const INLINE_MARKS = new Set([
  "EmphasisMark",
  "StrikethroughMark",
  "CodeMark",
  "LinkMark",
  "URL",
  "LinkTitle",
]);

function buildInline(view: EditorView): DecorationSet {
  const { state } = view;
  const decorations: Range<Decoration>[] = [];
  const codeBlocks: { from: number; to: number }[] = [];
  // Blocks that span two visible ranges are entered twice but decorated once.
  const admonitions = new Set<number>();
  for (const { from, to } of view.visibleRanges) {
    syntaxTree(state).iterate({
      from,
      to,
      enter: (node) => {
        const name = node.name;
        const heading = /^(?:ATXHeading([1-6])|SetextHeading([12]))$/.exec(name);
        if (heading) {
          const level = Number(heading[1] ?? heading[2]);
          const line = headingLines[level - 1];
          if (line) {
            decorations.push(line.range(state.doc.lineAt(node.from).from));
          }
        }
        if (name === "Table" && !selects(state, node.from, node.to)) {
          // Shown as a grid by `tableGrid`.
          return false;
        }
        if (name === "FencedCode") {
          codeBlocks.push({ from: node.from, to: node.to });
          decorateLines(state, decorations, node.from, node.to, codeLine);
          if (!touches(state, node.from, node.to)) {
            // Hide the fences; the language stays visible as a small label.
            const cursor = node.node.cursor();
            if (cursor.firstChild()) {
              do {
                if (cursor.name === "CodeMark") {
                  decorations.push(hidden.range(cursor.from, cursor.to));
                  const line = state.doc.lineAt(cursor.from);
                  if (
                    line.from > node.from &&
                    line.text.trim() === state.sliceDoc(cursor.from, cursor.to)
                  ) {
                    // The closing fence line keeps only a little space below the code.
                    decorations.push(fenceEnd.range(line.from));
                  }
                } else if (cursor.name === "CodeInfo") {
                  decorations.push(codeInfo.range(cursor.from, cursor.to));
                }
              } while (cursor.nextSibling());
            }
          }
          return false;
        }
        if (
          (name === "BulletList" || name === "OrderedList") &&
          !node.node.parent?.parent?.name.endsWith("List")
        ) {
          // Top-level lists are indented; nested lists keep the indentation of their source.
          decorateLines(state, decorations, node.from, node.to, () => listLine);
          return undefined;
        }
        if (name === "Blockquote") {
          decorateLines(state, decorations, node.from, node.to, () => quoteLine);
          return undefined;
        }
        if (name === "Admonition") {
          const mark = node.node.getChild("AdmonitionMark");
          if (mark && !admonitions.has(node.from)) {
            admonitions.add(node.from);
            decorateAdmonition(state, decorations, node.from, node.to, mark.from, mark.to);
          }
          return undefined;
        }
        if (name === "TaskMarker") {
          if (!onCursorLine(state, node.from, node.to)) {
            const checked = /[xX]/.test(state.sliceDoc(node.from + 1, node.from + 2));
            const checkbox = checkboxes[checked ? 1 : 0];
            if (checkbox) {
              decorations.push(checkbox.range(node.from, node.to));
            }
          }
          return undefined;
        }
        if (name === "QuoteMark") {
          if (!onCursorLine(state, node.from, node.to)) {
            // Hide "> " including one space after the marker.
            const after = state.sliceDoc(node.to, node.to + 1) === " " ? node.to + 1 : node.to;
            decorations.push(hidden.range(node.from, after));
          }
          return undefined;
        }
        if (name === "HorizontalRule") {
          if (!onCursorLine(state, node.from, node.to)) {
            decorations.push(horizontalRule.range(node.from, node.to));
          }
          return undefined;
        }
        if (name === "InlineCode") {
          decorations.push(inlineCode.range(node.from, node.to));
        }
        if (/^ATXHeading[1-6]$/.test(name)) {
          if (!onCursorLine(state, node.from, node.to)) {
            const mark = node.node.getChild("HeaderMark");
            if (mark) {
              // Hide "# " including the space after the marker.
              const end = Math.min(mark.to + 1, node.to);
              decorations.push(hidden.range(mark.from, end));
            }
          }
          return;
        }
        if (INLINE_CONTAINERS.has(name)) {
          if (touches(state, node.from, node.to)) {
            return false;
          }
          const cursor = node.node.cursor();
          if (cursor.firstChild()) {
            do {
              if (INLINE_MARKS.has(cursor.name) && cursor.to > cursor.from) {
                decorations.push(hidden.range(cursor.from, cursor.to));
              }
            } while (cursor.nextSibling());
          }
          return name === "Link" ? false : undefined;
        }
        if (name === "ListMark") {
          const text = state.sliceDoc(node.from, node.to);
          if (node.node.parent?.getChild("Task") && !onCursorLine(state, node.from, node.to)) {
            // A task item shows its checkbox instead of a bullet or number.
            const after = state.sliceDoc(node.to, node.to + 1) === " " ? node.to + 1 : node.to;
            decorations.push(hidden.range(node.from, after));
            return undefined;
          }
          if (
            (text === "-" || text === "*" || text === "+") &&
            !onCursorLine(state, node.from, node.to)
          ) {
            decorations.push(bullet.range(node.from, node.to));
          }
        }
        return undefined;
      },
    });
    // Blank lines between blocks are lower, so paragraphs read like rendered Markdown.
    for (let position = from; position <= to;) {
      const line = state.doc.lineAt(position);
      if (
        line.length === 0 &&
        !codeBlocks.some((block) => block.from <= line.from && block.to >= line.from)
      ) {
        decorations.push(blankLine.range(line.from));
      }
      position = line.to + 1;
    }
  }
  return Decoration.set(decorations, true);
}

const inlinePreview = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = buildInline(view);
    }
    update(update: ViewUpdate): void {
      if (
        update.docChanged ||
        update.selectionSet ||
        update.viewportChanged ||
        syntaxTree(update.startState) !== syntaxTree(update.state)
      ) {
        this.decorations = buildInline(update.view);
      }
    }
  },
  { decorations: (plugin) => plugin.decorations },
);

interface TableGrid {
  readonly tables: readonly TableBlock[];
  readonly decorations: DecorationSet;
}

/**
 * Shows each top-level table as an editable grid (`table-grid-view`). Only a selection that
 * covers part of a table, such as a search match, shows its source. Block widgets must come from
 * a state field. The table list is kept between cursor moves, so moving the cursor costs no tree
 * walk.
 */
function tableGrid(onOpenLink: (target: string) => void): StateField<TableGrid> {
  const build = (state: EditorState, tables: readonly TableBlock[]): TableGrid => {
    const builder = new RangeSetBuilder<Decoration>();
    for (const table of tables) {
      if (!selects(state, table.from, table.to)) {
        const widget = new TableGridWidget(
          state.sliceDoc(table.from, table.to),
          table.cells.length,
          onOpenLink,
        );
        builder.add(table.from, table.to, Decoration.replace({ widget, block: true }));
      }
    }
    return { tables, decorations: builder.finish() };
  };
  return StateField.define<TableGrid>({
    create: (state) => build(state, findTables(state)),
    update: (value, transaction) => {
      if (
        transaction.docChanged ||
        syntaxTree(transaction.startState) !== syntaxTree(transaction.state)
      ) {
        return build(transaction.state, findTables(transaction.state));
      }
      return transaction.selection ? build(transaction.state, value.tables) : value;
    },
    provide: (field) => EditorView.decorations.from(field, (value) => value.decorations),
  });
}

class FrontMatterWidget extends WidgetType {
  constructor(
    private readonly label: string,
    private readonly onActivate: () => void,
  ) {
    super();
  }
  override eq(other: FrontMatterWidget): boolean {
    return other.label === this.label;
  }
  toDOM(): HTMLElement {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "cm-lq-front-matter";
    button.textContent = this.label;
    button.addEventListener("mousedown", (event) => {
      event.preventDefault();
      this.onActivate();
    });
    return button;
  }
  override ignoreEvent(): boolean {
    return false;
  }
}

/** The front matter range in CodeMirror offsets, without the line break after the closing line. */
function frontMatterRange(state: EditorState): { from: number; to: number } | undefined {
  const block = findFrontMatter(state.doc.toString());
  if (!block) {
    return undefined;
  }
  const to = state.doc.lineAt(Math.max(block.start, block.end - 1)).to;
  return { from: state.doc.lineAt(block.start).from, to };
}

/** Hides the front matter behind a compact line; it stays in the document. */
function frontMatterField(label: string, onActivate: () => void): StateField<DecorationSet> {
  const widget = Decoration.replace({
    widget: new FrontMatterWidget(label, onActivate),
    block: true,
  });
  const build = (state: EditorState): DecorationSet => {
    const range = frontMatterRange(state);
    const builder = new RangeSetBuilder<Decoration>();
    if (range) {
      builder.add(range.from, range.to, widget);
    }
    return builder.finish();
  };
  return StateField.define<DecorationSet>({
    create: build,
    update: (decorations, transaction) =>
      transaction.docChanged ? build(transaction.state) : decorations,
    provide: (field) => [
      EditorView.decorations.from(field),
      EditorView.atomicRanges.of((view) => view.state.field(field)),
    ],
  });
}

/**
 * All live-preview extensions; the `Source` toggle removes them. The `cm-lq-preview` class
 * switches the editor to the reading layout (proportional font, text column, block styles), and
 * prose always wraps, independent of the `editor.wordWrap` setting that applies to source mode.
 */
export function livePreview(
  frontMatterLabel: string,
  onFrontMatter: () => void,
  onOpenLink: (target: string) => void,
) {
  return [
    EditorView.editorAttributes.of({ class: "cm-lq-preview" }),
    EditorView.lineWrapping,
    inlinePreview,
    tableGrid(onOpenLink),
    enterTable,
    frontMatterField(frontMatterLabel, onFrontMatter),
  ];
}
