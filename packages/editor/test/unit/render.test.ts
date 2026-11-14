import { describe, expect, it } from "vitest";
import { renderPreview } from "../../src";

const context = { pagePath: "guides/page.md", resourceBase: "https://resource.test/root/" };

describe("renderPreview", () => {
  it("renders the body without the front matter and records source lines", () => {
    const html = renderPreview("---\ntitle: Hidden\n---\n# Heading\n\nText\n");
    expect(html).not.toContain("Hidden");
    expect(html).toContain('<h1 data-line="3">Heading</h1>');
    expect(html).toContain('<p data-line="5">Text</p>');
  });

  it("shows raw HTML as source text and never as markup", () => {
    const html = renderPreview(
      [
        'Inline <b onclick="steal()">bold</b> text.',
        "",
        "<script>alert(1)</script>",
        "",
        '<iframe src="https://evil.test"></iframe>',
        "",
        '<img src="x" onerror="alert(1)">',
      ].join("\n"),
      context,
    );
    expect(html).not.toMatch(/<(script|iframe|b|img)[\s>]/);
    // Event handlers appear only as escaped text, never as attributes of an element.
    expect(html).not.toMatch(/<[a-z][^>]*\son[a-z]+=/);
    expect(html).toContain('<code class="lq-raw-html">&#x3C;b onclick="steal()"></code>');
    expect(html).toContain('<pre class="lq-raw-html" data-line="2"><code class="lq-raw-html">');
  });

  it("keeps code blocks as escaped text", () => {
    const html = renderPreview('```js\nlet a = "<img src=x onerror=alert(1)>";\n```\n');
    expect(html).toContain(
      '<code class="language-js"><span class="tok-keyword">let</span> a = <span class="tok-string">"&#x3C;img src=x',
    );
    expect(html).not.toContain("<img");
  });

  it("highlights fenced code blocks and keeps unknown languages as plain text", () => {
    const html = renderPreview("```yaml\nkey: 1 # c\n```\n\n```mermaid\ngraph TD\n```\n");
    expect(html).toContain('<span class="tok-property">key</span>');
    expect(html).toContain('<span class="tok-comment"># c</span>');
    expect(html).toContain('<code class="language-mermaid">graph TD\n</code>');
  });

  it("keeps column alignment of tables", () => {
    const html = renderPreview("| a | b | c |\n|:--|:-:|--:|\n| 1 | 2 | 3 |\n");
    expect(html).toContain('<th align="left">a</th>');
    expect(html).toContain('<td align="center">2</td>');
    expect(html).toContain('<td align="right">3</td>');
  });

  it("does not highlight indented code or raw HTML", () => {
    const html = renderPreview("    let a = 1;\n\n<div>x</div>\n");
    expect(html).not.toContain("tok-");
  });

  it("moves link destinations into data-lq-href without a navigable href", () => {
    const html = renderPreview(
      "[page](other.md#a) [web](https://example.org) [bad](javascript:alert(1))",
      context,
    );
    expect(html).not.toMatch(/\shref=/);
    expect(html).toContain('<a data-lq-href="other.md#a" tabindex="0" class="lq-link">page</a>');
    expect(html).toContain('data-lq-href="https://example.org"');
    expect(html).toContain('data-lq-href="javascript:alert(1)"');
  });

  it("loads images only from inside the content root", () => {
    const html = renderPreview(
      [
        "![local](img/a%20b.png)",
        "![parent](../shared/logo.svg)",
        "![remote](https://evil.test/track.png)",
        "![outside](../../secret.png)",
        "![scheme](file:///etc/passwd)",
        "![data](data:image/png;base64,AAAA)",
      ].join("\n\n"),
      context,
    );
    expect(html).toContain(
      '<img src="https://resource.test/root/guides/img/a%20b.png" alt="local">',
    );
    expect(html).toContain('src="https://resource.test/root/shared/logo.svg"');
    expect(html.match(/<img /g)).toHaveLength(2);
    for (const alt of ["remote", "outside", "scheme", "data"]) {
      expect(html).toContain(
        `<span class="lq-image-missing"><span class="codicon codicon-file-media" aria-hidden="true"></span> ${alt}</span>`,
      );
    }
    expect(html).not.toContain("evil.test");
    expect(html).not.toContain("passwd");
  });

  it("loads no images without a content root", () => {
    const html = renderPreview("![local](img/a.png)", {});
    expect(html).not.toContain("<img");
    expect(html).toContain("</span> local</span>");
  });

  it("renders task lists as disabled checkboxes", () => {
    const html = renderPreview("- [x] done\n- [ ] open\n");
    expect(html).toContain('<input type="checkbox" checked disabled> done');
    expect(html).toContain('<input type="checkbox" disabled> open');
  });

  it("renders Material admonitions and collapsible blocks as boxes", () => {
    const html = renderPreview(
      [
        '!!! warning "Careful"',
        "    Body **strong**",
        "",
        "???+ seealso",
        "    Open",
        "",
        "??? danger",
        "    Closed",
        "",
        '!!! note ""',
        "    No title",
        "",
        '=== "Tab A"',
        "    Content A",
      ].join("\n"),
    );
    expect(html).toContain(
      '<div class="lq-admonition lq-adm-warning" data-line="0"><p class="lq-admonition-title"><span class="codicon codicon-warning" aria-hidden="true"></span>Careful</p><p data-line="1">Body <strong>strong</strong></p></div>',
    );
    expect(html).toContain('<details class="lq-admonition lq-adm-note" open data-line="3">');
    expect(html).toContain("</span>Seealso</summary>");
    expect(html).toContain('<details class="lq-admonition lq-adm-danger" data-line="6">');
    expect(html).toContain(
      '<div class="lq-admonition lq-adm-note" data-line="9"><p data-line="10">No title</p></div>',
    );
    expect(html).toContain(
      '<div class="lq-tabs" data-line="12"><div class="lq-tab-bar" role="tablist"><span class="lq-tab-label lq-tab-active" role="tab" aria-selected="true" tabindex="0">Tab A</span></div><div class="lq-tab lq-tab-active" data-line="12"><p data-line="13">Content A</p></div></div>',
    );
  });

  it("groups consecutive content tabs and honors + and !", () => {
    const html = renderPreview(
      [
        '=== "A"',
        "    One",
        "",
        '===+ "B"',
        "    Two",
        "",
        '===! "C"',
        "    Three",
        "",
        '=== "D"',
        "    Four",
        "",
        "Text",
        "",
        '=== "E"',
        "    Five",
      ].join("\n"),
    );
    const groups = html.split('<div class="lq-tabs"').slice(1);
    expect(groups).toHaveLength(3);
    expect(groups[0]).toContain('aria-selected="false" tabindex="-1">A</span>');
    expect(groups[0]).toContain('aria-selected="true" tabindex="0">B</span>');
    expect(groups[0]).toContain(
      '<div class="lq-tab lq-tab-active" data-line="3"><p data-line="4">Two</p>',
    );
    expect(groups[1]).toContain('aria-selected="true" tabindex="0">C</span>');
    expect(groups[1]).toContain(">D</span>");
    expect(groups[1]).toContain('<p data-line="10">Four</p></div></div><p data-line="12">Text</p>');
    expect(groups[2]).toContain('aria-selected="true" tabindex="0">E</span>');
  });

  it("escapes content tab titles", () => {
    const html = renderPreview('=== "<b onclick=x()>T</b>"\n    Body\n');
    expect(html).not.toMatch(/<b[\s>]/);
    expect(html).toContain("&#x3C;b onclick=x()>T&#x3C;/b>");
  });

  it("escapes admonition titles", () => {
    const html = renderPreview('!!! note "<img src=x onerror=alert(1)>"\n    Body\n');
    expect(html).not.toContain("<img");
    expect(html).toContain("&#x3C;img src=x onerror=alert(1)>");
  });

  it("renders tables and footnotes with prefixed identifiers", () => {
    const html = renderPreview("| a | b |\n|---|---|\n| 1 | 2 |\n\nNote[^1].\n\n[^1]: Text.\n");
    expect(html).toContain('<table data-line="0">');
    expect(html).toContain('<tr data-line="2">');
    expect(html).toContain('data-lq-href="#fn-1"');
    expect(html).toContain('id="user-content-fn-1"');
  });
});
