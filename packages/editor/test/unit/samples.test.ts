import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { renderPreview } from "../../src";
import { codeLanguageFor, codeLanguages } from "../../src/code-languages";

/** The showcase pages of samples/demo, which the preview must render completely. */
const DOCS = resolve(import.meta.dirname, "../../../../samples/demo/docs");
const RESOURCE_BASE = "https://webview.test/docs/";

const pages = readdirSync(DOCS, { recursive: true, encoding: "utf8" })
  .filter((name) => name.endsWith(".md"))
  .map((name) => name.split(/[\\/]/).join("/"))
  .sort();

function read(path: string): string {
  return readFileSync(join(DOCS, ...path.split("/")), "utf8");
}

function preview(path: string): string {
  return renderPreview(read(path), { pagePath: path, resourceBase: RESOURCE_BASE });
}

describe("samples/demo in the preview", () => {
  it("has the showcase pages", () => {
    expect(pages).toEqual(
      expect.arrayContaining([
        "syntax/commonmark.md",
        "syntax/gfm.md",
        "syntax/material.md",
        "links/link-types.md",
        "special/crlf.md",
      ]),
    );
  });

  it.each(pages)("renders %s without navigable links, scripts, or raw HTML", (path) => {
    const html = preview(path);
    expect(html).not.toMatch(/<(?:script|div class="note"|span style|kbd)[\s>]/);
    expect(html).not.toMatch(/\shref=/);
    expect(html).toContain('data-line="');
  });

  it("shows a code block in every language the editor highlights", () => {
    const text = read("syntax/commonmark.md");
    const fenced = [...text.matchAll(/^(?:```|~~~)(\S+)$/gm)].map((match) => match[1] ?? "");
    const covered = new Set(fenced.map((info) => codeLanguageFor(info)?.name).filter(Boolean));
    expect([...covered].sort()).toEqual(
      codeLanguages()
        .map(({ name }) => name)
        .sort(),
    );
    // One fence uses a language the editor does not know and stays plain text.
    expect(fenced.some((info) => codeLanguageFor(info) === null)).toBe(true);
  });

  it("renders CommonMark blocks, raw HTML as text, and images from the content root", () => {
    const html = preview("syntax/commonmark.md");
    for (const level of [1, 2, 3, 4, 5, 6]) {
      expect(html).toContain(`<h${String(level)} `);
    }
    expect(html).toMatch(/<blockquote[^>]*>[\s\S]*<blockquote/);
    expect(html).toContain('<ol start="7"');
    expect(html).toContain("<hr");
    expect(html).toContain("&#x3C;script>");
    expect(html).toContain(`src="${RESOURCE_BASE}assets/diagram.svg"`);
    expect(html).not.toContain('https://example.com/logo.png"');
  });

  it("renders GFM tables, task lists, strikethrough, autolinks, and footnotes", () => {
    const html = preview("syntax/gfm.md");
    expect(html).toContain("<table");
    expect(html).toContain('<td align="right"');
    expect(html).toContain('<input type="checkbox" checked disabled>');
    expect(html).toContain("<del>");
    expect(html).toContain('data-lq-href="http://www.example.com"');
    expect(html).toContain('data-lq-href="#fn-check"');
  });

  it("renders admonitions, collapsible blocks, nesting, and content tab groups", () => {
    const html = preview("syntax/material.md");
    for (const type of ["note", "tip", "warning", "danger", "info", "example", "quote", "bug"]) {
      expect(html, type).toContain(`lq-adm-${type}`);
    }
    expect(html).toMatch(/<details class="lq-admonition lq-adm-question"(?! open)/);
    expect(html).toContain('<details class="lq-admonition lq-adm-success" open');
    expect(html).toMatch(/lq-adm-note[\s\S]*lq-adm-abstract[\s\S]*lq-adm-bug/);
    expect(html.split('<div class="lq-tabs"')).toHaveLength(3);
    expect(html).toContain('aria-selected="true" tabindex="0">Windows</span>');
    expect(html).toContain("--8&#x3C;--");
  });

  it("keeps CRLF line endings in the CRLF page", () => {
    const text = read("special/crlf.md");
    expect(text).toContain("\r\n");
    expect(text.replace(/\r\n/g, "")).not.toContain("\n");
  });
});
