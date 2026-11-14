---
title: CommonMark
---

# CommonMark

Every block and inline element of [CommonMark](https://spec.commonmark.org/). Back to the
[overview](../index.md).

## Headings

### Level 3

#### Level 4

##### Level 5

###### Level 6

Setext heading level 1
======================

Setext heading level 2
----------------------

## Paragraphs and line breaks

A paragraph consists of lines
that follow each other without a blank line and wrap together.

Two spaces at the end of a line  
force a break, and so does a backslash\
at the end of a line.

## Emphasis

*italic* and _italic_, **bold** and __bold__, ***bold and italic***, **bold with *italic* inside**,
`inline code` and ``code with a ` backtick``.

Escapes: \*no emphasis\*, \`no code\`, \# no heading, \[no link\](x.md).

Character references: &copy; &amp; &#169; &#x2603; &nbsp;protected.

## Lists

- Unordered with `-`
- Second item
  - Nested
    - Deeper still
- Third item with two paragraphs

  Second paragraph in the same item.

* Unordered with `*`
+ Unordered with `+`

1. Ordered
2. Second step
   1. Substep
   2. Substep
3. Third step

7) Starts at seven
8) With a parenthesis instead of a period

## Quotes

> A quote.
>
> > A nested quote with **emphasis** and a list:
> >
> > - Item A
> > - Item B

## Thematic breaks

---

***

___

## Code

Indented code:

    Four spaces of indentation
    are not highlighted.

Fenced code without a language:

```
Plain text without highlighting
```

With tildes and an unknown language:

~~~brainfuck
++++++++[>++++[>++>+++<<-]>-]<<.
~~~

Every language that Lorequill highlights:

```javascript
export function greet(name) {
  return `Hello ${name}`;
}
```

```typescript
interface Page { readonly title: string; aliases?: string[] }
const page: Page = { title: "Welcome" };
```

```json
{ "title": "Welcome", "aliases": ["Start"], "draft": false, "order": 1 }
```

```css
.admonition.note { border-left: 4px solid #448aff; }
```

```html
<section class="hero"><h1>Welcome</h1><!-- Comment --></section>
```

```xml
<?xml version="1.0"?>
<page id="1"><title>Welcome</title></page>
```

```python
def slugify(value: str) -> str:
    """Lower-case and dash-separate."""
    return "-".join(value.lower().split())
```

```yaml
title: Welcome
aliases: [Start]
nav:
  - index.md
```

```sql
SELECT title, path FROM pages WHERE draft = FALSE ORDER BY title;
```

```shell
npm run package --workspace vscode-lorequill
git switch -c docs/new-page
```

```powershell
Get-ChildItem -Path docs -Filter *.md | Select-Object Name
```

```dockerfile
FROM node:22-alpine
RUN npm ci --omit=dev
```

```toml
[project]
name = "lorequill-demo"
```

```properties
# Comment
site.name = Lorequill Demo
```

```diff
- old title
+ new title
```

## Links and images

A [relative link](../links/link-types.md), a link with a
[title](../index.md "To the overview"), a [reference link][gfm], and an autolink URL
<https://www.mkdocs.org/>.

![Diagram with three boxes](../assets/diagram.svg "A diagram from the content folder")

An image outside the content folder is not loaded and is replaced by its alternative text:
![External logo](https://example.com/logo.png).

[gfm]: gfm.md "GitHub Flavored Markdown"

## Raw HTML

The preview shows raw HTML as source and runs nothing.

<div class="note">
  <strong>Block element</strong> in HTML
</div>

Inline <kbd>Ctrl</kbd>+<kbd>S</kbd> and <span style="color: red">colored</span>.

<script>alert("never runs")</script>
