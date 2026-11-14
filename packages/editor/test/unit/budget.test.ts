import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { ensureSyntaxTree } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import { parseMarkdown } from "@lorequill/markdown/parse";
import { describe, expect, it } from "vitest";
import { admonitionSyntax } from "../../src/admonition-syntax";
import { codeLanguages } from "../../src/code-languages";
import { renderPreview } from "../../src/render";
import { findTables } from "../../src/table-grid";
import { largePage } from "../fixtures/large-page";

/**
 * Editing budget of specification §15 for a 1 MiB page (decision D27). The limits leave headroom
 * for the CI runners (D7); they catch regressions that make the
 * work grow faster than the page, not small slowdowns. Failure messages show the measured time.
 * Measured on a development machine: preview 3.4 s, editor parse 0.25 s, edit 12 ms.
 */
function timed<T>(work: () => T): { result: T; ms: number } {
  const started = performance.now();
  const result = work();
  return { result, ms: performance.now() - started };
}

describe("editing budget for a 1 MiB page", () => {
  const text = largePage();

  it("renders the preview within 20 seconds", () => {
    const { result, ms } = timed(() => renderPreview(text));
    expect(result.length).toBeGreaterThan(text.length / 2);
    expect(ms, `preview took ${ms.toFixed(0)} ms`).toBeLessThan(20_000);
  }, 60_000);

  it("parses a page of many quotes and lists in linear time", () => {
    // micromark rebuilt all events for every closed quote or list, which took over 100 seconds
    // for this page; `patches/micromark+*.patch` fixes it. A failure here means the patch is gone.
    const block = "> A quote with *emphasis*.\n\n- item\n- item\n\n";
    const quotes = block.repeat(Math.ceil((1024 * 1024) / block.length));
    const { ms } = timed(() => parseMarkdown(quotes));
    expect(ms, `parsing took ${ms.toFixed(0)} ms`).toBeLessThan(30_000);
  }, 120_000);

  it("parses the page in the editor and updates it after an edit", () => {
    const state = EditorState.create({
      doc: text,
      extensions: markdown({
        base: markdownLanguage,
        extensions: [admonitionSyntax],
        codeLanguages: codeLanguages(),
      }),
    });
    const full = timed(() => ensureSyntaxTree(state, state.doc.length, 60_000));
    expect(full.result).not.toBeNull();
    expect(full.ms, `full parse took ${full.ms.toFixed(0)} ms`).toBeLessThan(5_000);

    const edit = timed(() => {
      const next = state.update({ changes: { from: text.length >> 1, insert: "x" } }).state;
      ensureSyntaxTree(next, next.doc.length, 60_000);
      return findTables(next);
    });
    expect(edit.result.length).toBeGreaterThan(100);
    expect(edit.ms, `edit took ${edit.ms.toFixed(0)} ms`).toBeLessThan(500);
  }, 60_000);
});
