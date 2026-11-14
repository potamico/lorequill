import {
  LanguageDescription,
  LanguageSupport,
  StreamLanguage,
  languageDataProp,
  type StreamParser,
} from "@codemirror/language";
import { css } from "@codemirror/lang-css";
import { html } from "@codemirror/lang-html";
import { javascript } from "@codemirror/lang-javascript";
import { json } from "@codemirror/lang-json";
import { python } from "@codemirror/lang-python";
import { sql } from "@codemirror/lang-sql";
import { xml } from "@codemirror/lang-xml";
import { yaml } from "@codemirror/lang-yaml";
import { diff } from "@codemirror/legacy-modes/mode/diff";
import { dockerFile } from "@codemirror/legacy-modes/mode/dockerfile";
import { powerShell } from "@codemirror/legacy-modes/mode/powershell";
import { properties } from "@codemirror/legacy-modes/mode/properties";
import { shell } from "@codemirror/legacy-modes/mode/shell";
import { toml } from "@codemirror/legacy-modes/mode/toml";
import type { NodeType } from "@lezer/common";
import { highlightCode, tagHighlighter, tags, type Highlighter } from "@lezer/highlight";

function stream(parser: StreamParser<unknown>): LanguageSupport {
  return new LanguageSupport(StreamLanguage.define(parser));
}

function language(name: string, alias: string[], support: LanguageSupport): LanguageDescription {
  return LanguageDescription.of({ name, alias, support });
}

let languages: readonly LanguageDescription[] | undefined;
let highlighter: Highlighter | undefined;

/**
 * Languages highlighted in fenced code blocks (specification §8). All parsers are bundled, so the
 * webview never loads code at run time. The editor and the rendered preview use the same list,
 * matched against the first word of the info string, so both modes agree on the language.
 *
 * Built on first use, so that importing this package's index (as the extension host does for the
 * protocol) does not construct any parser.
 */
export function codeLanguages(): readonly LanguageDescription[] {
  languages ??= [
    language("JavaScript", ["js", "jsx", "mjs", "cjs", "node"], javascript({ jsx: true })),
    language(
      "TypeScript",
      ["ts", "tsx", "mts", "cts"],
      javascript({ typescript: true, jsx: true }),
    ),
    language("JSON", ["jsonc", "json5"], json()),
    language("CSS", [], css()),
    language("HTML", ["htm", "xhtml"], html()),
    language("XML", ["svg", "xsd", "xsl", "xslt"], xml()),
    language("Python", ["py", "python3", "py3"], python()),
    language("YAML", ["yml"], yaml()),
    language("SQL", ["postgresql", "postgres", "mysql", "sqlite"], sql()),
    language("Shell", ["sh", "bash", "zsh", "ksh", "console"], stream(shell)),
    language("PowerShell", ["ps1", "pwsh"], stream(powerShell)),
    language("Dockerfile", ["docker"], stream(dockerFile)),
    language("TOML", [], stream(toml)),
    language("Properties", ["ini", "cfg", "conf"], stream(properties)),
    language("Diff", ["patch", "udiff"], stream(diff)),
  ];
  return languages;
}

/**
 * The language of a fenced code block, from the first word of its info string, exactly as
 * `@codemirror/lang-markdown` matches it: by name or alias, ignoring case, and also as a word
 * inside the info, so that `{.python` finds Python. `null` means plain text.
 */
export function codeLanguageFor(info: string): LanguageDescription | null {
  const word = /\S*/.exec(info.trim())?.[0] ?? "";
  return word === "" ? null : LanguageDescription.matchLanguageName(codeLanguages(), word, true);
}

/**
 * Assigns `tok-*` classes to code tokens. It applies only inside the code languages above, never
 * to the Markdown text around them, so headings, links, or HTML blocks keep their own styling.
 * The colors come from the VS Code theme (see `main.css`).
 */
export function codeHighlighter(): Highlighter {
  if (highlighter) {
    return highlighter;
  }
  const data = new Set(codeLanguages().map((description) => description.support?.language.data));
  highlighter = tagHighlighter(
    [
      { tag: [tags.keyword, tags.modifier, tags.controlKeyword], class: "tok-keyword" },
      { tag: [tags.atom, tags.bool, tags.null], class: "tok-atom" },
      { tag: [tags.number, tags.integer, tags.float], class: "tok-number" },
      { tag: [tags.string, tags.character, tags.attributeValue], class: "tok-string" },
      { tag: [tags.regexp, tags.escape, tags.special(tags.string)], class: "tok-string2" },
      { tag: tags.comment, class: "tok-comment" },
      { tag: tags.function(tags.variableName), class: "tok-function" },
      { tag: [tags.typeName, tags.className, tags.namespace, tags.tagName], class: "tok-type" },
      { tag: [tags.propertyName, tags.attributeName], class: "tok-property" },
      {
        tag: [tags.macroName, tags.labelName, tags.special(tags.variableName)],
        class: "tok-macro",
      },
      { tag: [tags.meta, tags.processingInstruction], class: "tok-meta" },
      { tag: tags.inserted, class: "tok-inserted" },
      { tag: tags.deleted, class: "tok-deleted" },
      { tag: tags.invalid, class: "tok-invalid" },
    ],
    { scope: (type: NodeType) => data.has(type.prop(languageDataProp)) },
  );
  return highlighter;
}

/** A run of code text with the highlight classes it gets (empty for plain text). */
export interface CodeToken {
  readonly text: string;
  readonly classes: string;
}

/**
 * Highlights the content of a fenced code block for the rendered preview. Returns `undefined`
 * when the info string names no supported language, so the caller keeps the plain text. Line
 * breaks are part of the token text, so joining all tokens gives back `code` unchanged.
 */
export function highlightCodeBlock(info: string, code: string): CodeToken[] | undefined {
  const support = codeLanguageFor(info)?.support;
  if (!support) {
    return undefined;
  }
  const tokens: CodeToken[] = [];
  const push = (text: string, classes: string): void => {
    const last = tokens[tokens.length - 1];
    if (last?.classes === classes) {
      tokens[tokens.length - 1] = { text: last.text + text, classes };
    } else if (text !== "") {
      tokens.push({ text, classes });
    }
  };
  highlightCode(code, support.language.parser.parse(code), codeHighlighter(), push, () => {
    push("\n", "");
  });
  return tokens;
}
