import type {
  Element,
  ElementContent,
  Nodes as HastNodes,
  Properties,
  Root as HastRoot,
} from "hast";
import type { Html, Parents } from "mdast";
import { defaultSchema, sanitize, type Schema } from "hast-util-sanitize";
import { toHtml } from "hast-util-to-html";
import { toHast, type Handler, type Handlers, type State } from "mdast-util-to-hast";
import { resolveLinkDestination } from "@lorequill/markdown/link-target";
import { parseMarkdown, type Container } from "@lorequill/markdown/parse";
import { ADMONITION_ICONS, admonitionFamily } from "./admonition-syntax";
import { highlightCodeBlock } from "./code-languages";

/** Where the page lives, so that relative images can be shown (specification §8). */
export interface PreviewContext {
  /** POSIX path of the page relative to the content root; absent outside a content root. */
  readonly pagePath?: string;
  /** Webview URI of the content root, ending in `/`; absent if images cannot be loaded. */
  readonly resourceBase?: string;
}

/**
 * Renders a page as the read-only preview of `Both` and `Preview` (specification §8, D22).
 *
 * The preview comes from the same syntax tree as links and checks (`parseMarkdown`), converted
 * with `mdast-util-to-hast` and cleaned by `hast-util-sanitize`, so it cannot disagree with the
 * checks about the document's structure. It is an approximation of the site:
 *
 * - Raw HTML is never interpreted; it is shown as source text, so nothing disappears silently.
 * - Links keep no `href`: the destination goes into `data-lq-href`, and the webview asks the
 *   host to open it, which resolves it like Ctrl+click does.
 * - Images load only from inside the content root, through `resourceBase`; any other image
 *   (remote, outside the root, unsupported scheme) is replaced by its alternative text.
 * - Block elements carry `data-line` (0-based source line) for scroll synchronization.
 * - Material for MkDocs admonitions and collapsible blocks become boxes, content tabs tab groups.
 * - Fenced code blocks are highlighted with the same parsers as the editor (`code-languages.ts`).
 */
export function renderPreview(text: string, context: PreviewContext = {}): string {
  const { root } = parseMarkdown(text);
  const tree = toHast(root, {
    handlers: { container: containerHandler, html: htmlHandler } as Handlers,
    // `hast-util-sanitize` adds the prefix; adding it twice would break footnote links.
    clobberPrefix: "",
  });
  rewrite(tree, context);
  return toHtml(sanitize(tree, PREVIEW_SCHEMA));
}

/** Blocks whose source line is recorded for scroll synchronization. */
const LINE_TAGS = new Set([
  "p",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "pre",
  "blockquote",
  "li",
  "table",
  "tr",
  "hr",
  "div",
  "details",
]);

const LQ_CLASS = /^lq-[a-z-]+$/;
const CODICON_CLASS = /^codicon(?:-[a-z-]+)?$/;
const TOKEN_CLASS = /^tok-[a-z0-9]+$/;

/** GitHub's schema, extended only by what the preview itself generates. */
const PREVIEW_SCHEMA: Schema = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    "*": [...(defaultSchema.attributes?.["*"] ?? []), "dataLine"],
    a: [
      ...(defaultSchema.attributes?.a ?? []).filter(
        (rule) => !(Array.isArray(rule) && rule[0] === "className"),
      ),
      "dataLqHref",
      ["className", "data-footnote-backref", "lq-link"],
    ],
    code: [["className", /^language-./, "lq-raw-html"]],
    div: [...(defaultSchema.attributes?.div ?? []), ["className", LQ_CLASS], ["role", "tablist"]],
    details: [["className", LQ_CLASS]],
    summary: [["className", LQ_CLASS]],
    p: [["className", LQ_CLASS]],
    td: [["align", "left", "center", "right"]],
    th: [["align", "left", "center", "right"]],
    pre: [["className", "lq-raw-html"]],
    span: [
      ["className", LQ_CLASS, CODICON_CLASS, TOKEN_CLASS],
      "ariaHidden",
      ["role", "tab"],
      "ariaSelected",
    ],
  },
};

function classes(...names: string[]): Properties {
  return { className: names };
}

/** The marker of each rendered content tab (`===`, `===+`, `===!`, `===+!`), for grouping. */
const tabMarkers = new WeakMap<Element, string>();

const containerHandler: Handler = (state: State, node: Container): Element => {
  const body = state.all(node);
  let result: Element;
  if (node.kind === "tab") {
    result = {
      type: "element",
      tagName: "div",
      properties: classes("lq-tab"),
      children: [titleElement("p", ["lq-tab-title"], node.title ?? "", undefined), ...body],
    };
    tabMarkers.set(result, node.marker);
  } else {
    const type = node.containerType?.split(/[ \t]+/)[0] ?? "note";
    const family = admonitionFamily(type);
    const title = node.title ?? type.charAt(0).toUpperCase() + type.slice(1);
    const icon = ADMONITION_ICONS[family] ?? "edit";
    const box = ["lq-admonition", `lq-adm-${family}`];
    if (node.kind === "details") {
      result = {
        type: "element",
        tagName: "details",
        properties: { ...classes(...box), open: node.marker.includes("+") },
        children: [titleElement("summary", ["lq-admonition-title"], title, icon), ...body],
      };
    } else {
      // `!!! note ""` hides the title, as in Material for MkDocs.
      result = {
        type: "element",
        tagName: "div",
        properties: classes(...box),
        children:
          title === "" ? body : [titleElement("p", ["lq-admonition-title"], title, icon), ...body],
      };
    }
  }
  state.patch(node, result);
  return result;
};

function titleElement(
  tagName: string,
  names: string[],
  title: string,
  icon: string | undefined,
): Element {
  const children: ElementContent[] = [];
  if (icon) {
    children.push({
      type: "element",
      tagName: "span",
      properties: { className: ["codicon", `codicon-${icon}`], ariaHidden: "true" },
      children: [],
    });
  }
  children.push({ type: "text", value: title });
  return { type: "element", tagName, properties: classes(...names), children };
}

const PHRASING_PARENTS = new Set([
  "paragraph",
  "heading",
  "emphasis",
  "strong",
  "delete",
  "link",
  "linkReference",
  "tableCell",
]);

/** Raw HTML is shown as source text, never interpreted (§15). */
const htmlHandler: Handler = (state: State, node: Html, parent: Parents | undefined): Element => {
  const code: Element = {
    type: "element",
    tagName: "code",
    properties: classes("lq-raw-html"),
    children: [{ type: "text", value: node.value }],
  };
  const result: Element =
    parent && PHRASING_PARENTS.has(parent.type)
      ? code
      : {
          type: "element",
          tagName: "pre",
          properties: classes("lq-raw-html"),
          children: [code],
        };
  state.patch(node, result);
  return result;
};

function rewrite(node: HastRoot | HastNodes, context: PreviewContext): void {
  if (!("children" in node)) {
    return;
  }
  groupTabs(node);
  node.children.forEach((child, index) => {
    if (child.type !== "element") {
      return;
    }
    if (child.tagName === "a") {
      rewriteLink(child);
    } else if (child.tagName === "code" && "tagName" in node && node.tagName === "pre") {
      highlight(child);
    } else if (child.tagName === "img") {
      const replacement = rewriteImage(child, context);
      if (replacement) {
        node.children[index] = replacement;
        return;
      }
    }
    const line = child.position?.start.line;
    if (line !== undefined && LINE_TAGS.has(child.tagName)) {
      child.properties.dataLine = line - 1;
    }
    rewrite(child, context);
  });
}

/** Replaces the text of a fenced code block with highlighted spans, if its language is known. */
function highlight(code: Element): void {
  const className = code.properties.className;
  const language = Array.isArray(className)
    ? className.find((name) => typeof name === "string" && name.startsWith("language-"))
    : undefined;
  const text = code.children.length === 1 ? code.children[0] : undefined;
  if (typeof language !== "string" || text?.type !== "text") {
    return;
  }
  const tokens = highlightCodeBlock(language.slice("language-".length), text.value);
  if (tokens) {
    code.children = tokens.map(({ text: value, classes: names }): ElementContent =>
      names === ""
        ? { type: "text", value }
        : {
            type: "element",
            tagName: "span",
            properties: { className: names.split(" ") },
            children: [{ type: "text", value }],
          },
    );
  }
}

/**
 * Joins consecutive content tabs into a tab group, as Material for MkDocs does: a bar of labels
 * and one panel per tab, of which one is shown. `===!` starts a new group, and `===+` selects its
 * tab (otherwise the first). The webview's own script switches tabs; without it, the selected
 * tab stays visible.
 */
function groupTabs(parent: HastRoot | Element): void {
  // Root children are the widest type; an element only ever holds element content here.
  const children: HastRoot["children"] = [];
  let group: Element[] = [];
  const flush = (): void => {
    if (group.length > 0) {
      children.push(tabGroup(group));
      group = [];
    }
  };
  for (const child of parent.children) {
    const marker = child.type === "element" ? tabMarkers.get(child) : undefined;
    if (child.type === "element" && marker !== undefined) {
      if (marker.includes("!")) {
        flush();
      }
      group.push(child);
    } else if (!(group.length > 0 && child.type === "text" && child.value.trim() === "")) {
      flush();
      children.push(child);
    }
  }
  flush();
  if (parent.type === "root") {
    parent.children = children;
  } else {
    parent.children = children as ElementContent[];
  }
}

function tabGroup(tabs: Element[]): Element {
  const selected = Math.max(
    0,
    tabs.findIndex((tab) => tabMarkers.get(tab)?.includes("+")),
  );
  const labels: ElementContent[] = [];
  tabs.forEach((tab, index) => {
    const [title, ...body] = tab.children;
    const active = index === selected;
    labels.push({
      type: "element",
      tagName: "span",
      properties: {
        className: active ? ["lq-tab-label", "lq-tab-active"] : ["lq-tab-label"],
        role: "tab",
        ariaSelected: active ? "true" : "false",
        tabIndex: active ? 0 : -1,
      },
      children: title?.type === "element" ? title.children : [],
    });
    tab.children = body;
    // Grouped once: the panels inside the group are not grouped again.
    tabMarkers.delete(tab);
    tab.properties.className = active ? ["lq-tab", "lq-tab-active"] : ["lq-tab"];
  });
  return {
    type: "element",
    tagName: "div",
    properties: classes("lq-tabs"),
    children: [
      {
        type: "element",
        tagName: "div",
        properties: { className: ["lq-tab-bar"], role: "tablist" },
        children: labels,
      },
      ...tabs,
    ],
    ...(tabs[0]?.position ? { position: tabs[0].position } : {}),
  };
}

function rewriteLink(link: Element): void {
  const href = link.properties.href;
  delete link.properties.href;
  if (typeof href === "string" && href !== "") {
    link.properties.dataLqHref = href;
    link.properties.tabIndex = 0;
    const existing = link.properties.className;
    link.properties.className = [...(Array.isArray(existing) ? existing : []), "lq-link"];
  }
}

/** Returns a replacement for an image that must not be loaded, or `undefined` to keep it. */
function rewriteImage(image: Element, context: PreviewContext): Element | undefined {
  const src = image.properties.src;
  const alt = typeof image.properties.alt === "string" ? image.properties.alt : "";
  if (typeof src === "string" && context.pagePath !== undefined && context.resourceBase) {
    const destination = resolveLinkDestination(context.pagePath, src);
    if (destination.kind === "path") {
      image.properties.src =
        context.resourceBase + destination.path.split("/").map(encodeURIComponent).join("/");
      return undefined;
    }
  }
  return {
    type: "element",
    tagName: "span",
    properties: classes("lq-image-missing"),
    children: [
      {
        type: "element",
        tagName: "span",
        properties: { className: ["codicon", "codicon-file-media"], ariaHidden: "true" },
        children: [],
      },
      { type: "text", value: alt === "" ? "" : ` ${alt}` },
    ],
  };
}
