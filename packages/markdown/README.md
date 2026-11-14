# @lorequill/markdown

Pure functions for the Markdown files of a Lorequill repository: YAML front matter (read and edit
without touching the rest of the file), page titles, filename slugs, the shared Markdown parser,
links, heading anchors, and link-target resolution. Specification: sections 8, 9, and 10.

This package has no dependency on VS Code. It is currently an internal workspace package
(`private`) consumed as TypeScript source. Editor, checks, and CI use this one parser and resolver.

## API

```ts
import {
  proposeFilename,
  readFrontMatter,
  readPageMetadata,
  updateFrontMatter,
} from "@lorequill/markdown";

readFrontMatter(text); // { status: "none" } | { status: "ok", block, data } | { status: "invalid", block, issues }

readPageMetadata(text, "page.md"); // { title, titleSource, aliases, frontMatter }

const result = updateFrontMatter(text, [
  { op: "set", key: "title", value: "New title" },
  { op: "set-date", key: "created", value: "2026-11-03" },
  { op: "remove", key: "status" },
]);
if (result.ok) {
  result.changed; // false when the text would not change
  result.edits; // minimal line-level TextEdit[] for the editor
  result.text; // the complete new text
} else {
  result.issues; // nothing was rewritten
}

proposeFilename("Identität", ["identitaet.md"]); // "identitaet-2.md"
```

Issues carry a stable `code` (also the English message key), an optional 1-based `line` and
`column`, and `params`. The package never produces localized text. Rejected values are not copied
into issues.

### Links and anchors

```ts
import {
  collectAnchors,
  createFileSystemTargetProvider,
  extractLinks,
  parseMarkdown,
  relativeLinkPath,
  resolveLinkDestination,
} from "@lorequill/markdown";

const document = parseMarkdown(text); // mdast tree with exact positions
extractLinks(document); // [{ kind, destination, title?, label?, start, end }]
collectAnchors(document, "ascii"); // Set of heading anchors and raw-HTML ids

resolveLinkDestination("guides/setup.md", "../index.md#intro");
// { kind: "path", path: "index.md", fragment: "intro" }

const targets = createFileSystemTargetProvider("/repo/docs");
await targets.describe("index.md"); // "file" | "directory" | "missing" | "outside" | "unsupported"

relativeLinkPath("guides/setup.md", "index.md", "intro"); // "../index.md#intro"
```

## Front matter

- Front matter is a block that starts on the first line (an optional byte order mark is allowed)
  with a line `---` and ends at the next line that is exactly `---` (trailing spaces and tabs are
  allowed; `----` is not a delimiter). Without a closing delimiter the file has no front matter.
- The YAML rules are the same as for the profile: YAML 1.2 core schema; syntax errors, duplicate
  keys, merge keys, anchors, aliases, and every explicit tag are rejected. Nothing is evaluated.
  The check lives here as well as in `@lorequill/profile` because both packages must stay
  independent; a shared package is not worth it for this small amount of code.
- The front matter must be a mapping (or empty). A list or a scalar is `front-matter-not-a-mapping`.

## Editing guarantees

`updateFrontMatter` works on the parsed YAML document, not on a rebuilt object:

- The body is never touched. Line endings (LF or CRLF), trailing whitespace, tabs, and a missing
  final newline are kept. Only front matter lines change, and the returned `edits` replace only
  the lines that differ.
- Unknown keys, key order, comments, quote style, and the flow or block style of lists survive. A
  string that is replaced in an existing scalar keeps that scalar's quote style and comment.
- Invalid YAML (including duplicate keys and unsupported constructs) is never rewritten: the result
  is `ok: false` with issues and no text.
- Text without front matter gets a new block in front of the body (after a byte order mark).
- A set to the value a key already has returns `changed: false` and no edits.
- Every result is verified: the new text is parsed again and must equal the intended data, otherwise
  the update fails with `roundtrip-mismatch` instead of writing something different.

### Values and quoting

- Dates are strings. `set-date` accepts only valid calendar dates in `YYYY-MM-DD` form and writes
  them quoted, so neither a YAML 1.1 parser (MkDocs uses PyYAML) nor a YAML timestamp resolver can
  turn them into a date object.
- Strings that other parsers could read as something else are double-quoted: YAML 1.1 words
  (`yes`, `no`, `on`, `off`, `y`, `n`, ...), `true`, `null`, `~`, numbers (including `0x`, `1e3`,
  `1_000`, and `1:30`), timestamps, the empty string, and strings with leading or trailing spaces.
- Lists such as `aliases` stay lists, also with one entry or none. Long strings are not folded.
- Keys must be non-empty and free of control characters.

## Page title and aliases

`readPageMetadata` returns the title with its source: the front matter `title` (a non-empty string
only), else the first Markdown heading of the body, else the file name exactly as given. A heading
is an ATX heading (`# Title`, closing hashes and a trailing `{ #id .class }` attribute list are
removed) or a setext heading; headings inside fenced code (backticks or tildes) and indented code
are ignored. Aliases are the non-empty strings of the front matter `aliases` list.

## Filename slugs

`slugifyTitle` is deterministic and idempotent. The steps:

1. Normalize to NFC. `ä→ae`, `ö→oe`, `ü→ue`, `ß→ss`, also for capitals (`ẞ→ss`).
2. Lowercase; remove Latin diacritics (`é→e`) by removing combining marks in U+0300 to U+036F.
3. Whitespace becomes a hyphen. Everything except letters, combining marks, digits, and hyphens is
   removed. Letters of other scripts are kept.
4. Repeated hyphens collapse; leading and trailing hyphens are removed.
5. The result is cut to 80 characters (never inside a code point).
6. Windows device names (`con`, `prn`, `aux`, `nul`, `com0` to `com9`, `lpt0` to `lpt9`) get the
   suffix `-page`.
7. An empty result becomes `untitled`.

`proposeFilename` appends `.md` and, if the name is taken, uses `-2`, `-3`, and so on. Names are
compared case-insensitively and independent of Unicode normalization, so the proposal also works on
case-insensitive file systems. The result does not depend on the order of the existing names.

### Decisions beyond the specification

The specification gives the examples and the German transliteration but not these details. They are
conservative and can be changed together with the tests:

| Area             | Decision                                                                             |
| ---------------- | ------------------------------------------------------------------------------------ |
| Underscore, dots | Removed (`snake_case` becomes `snakecase`, `Version 2.0` becomes `version-20`).      |
| Diacritics       | Removed for Latin letters; combining marks of other scripts are kept.                |
| Length           | At most 80 characters.                                                               |
| Reserved names   | Suffix `-page`.                                                                      |
| Empty result     | `untitled`.                                                                          |
| Collisions       | `-2`, `-3`, ..., compared case-insensitively.                                        |
| Front matter     | Strings that PyYAML would read as another type are quoted; dates are quoted strings. |
| Delimiters       | `---` with optional trailing spaces and tabs; `----` is not a delimiter.             |

## Markdown parsing

`parseMarkdown` uses `micromark` and `mdast-util-from-markdown` with the GFM extensions, so it
follows CommonMark exactly and every node carries line, column, and UTF-16 offset. Two additions
make it fit MkDocs repositories:

- **Front matter** is parsed as blank lines, so it never becomes a thematic break or a setext
  heading, and positions in the body stay exact.
- **Material for MkDocs containers** (`!!! type "Title"`, `??? type`, `???+ type`, `=== "Tab"`)
  become `container` nodes. Their body, the following lines that are blank or indented by four more
  columns, is de-indented and parsed as nested Markdown with positions mapped back to the original
  text. Like Python-Markdown, an indented block after a blank line still continues the body.

### Decisions beyond the specification

| Area                 | Decision                                                                                                                                           |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Container headers    | `!!!` and `???` need a type word; tabs need a quoted title, so a setext underline `===` is never a tab. `/// admonition` blocks are not supported. |
| Indented markers     | A marker indented by four or more columns is a container only inside a list item; elsewhere it is an indented code block.                          |
| Reference links      | Reported once, at the definition, even when unused; uses of a reference are not reported again.                                                    |
| Undefined references | `[text][missing]` is plain text (CommonMark), not a broken link.                                                                                   |
| Raw HTML             | Never interpreted: `<a href>` is not a link. `id` and `name` attributes in raw HTML count as fragment targets.                                     |
| Images               | Not page links; their alternative text does not contribute to heading anchors (as in Python-Markdown).                                             |
| Snippets             | `--8<--` includes are left as text and not followed.                                                                                               |

## Heading anchors

`slugify: ascii` reproduces the default `slugify` of Python-Markdown's `toc` extension (MkDocs
default); `slugify: unicode` reproduces `pymdownx.slugs.slugify(case="lower")` (Material for
MkDocs recommendation). The heading text is taken like `toc` takes it: inline formatting, link
text, and code are kept; images and HTML tags are dropped; whitespace runs collapse to one space.
Explicit identifiers from a trailing attribute list (`{#id}`, `{ #id }`, `{: #id .class }`) are
kept and reserved first; other anchors are made unique with `_1`, `_2`, ...; an empty slug becomes
`_1`. Headings inside containers count in document order.

Note that anchors and filenames differ: with `ascii`, `Identität` becomes the anchor `identitat`
but the filename `identitaet.md` (§10).

The algorithm is tested against `fixtures/anchors/python-markdown.json`, generated with the real
libraries by `scripts/anchors/generate.py` (pinned versions in `scripts/anchors/requirements.txt`).
To regenerate, for example after a version update:

```bash
python3 -m venv /tmp/anchors-venv
/tmp/anchors-venv/bin/pip install -r packages/markdown/scripts/anchors/requirements.txt
/tmp/anchors-venv/bin/python -I packages/markdown/scripts/anchors/generate.py
```

The site build (`mkdocs build --strict`) remains authoritative; a site with a custom `slugify`
can differ.

## Link targets

`resolveLinkDestination` is lexical: it percent-decodes, normalizes, and keeps the result inside
the content root (`..` is fine while it stays inside). `http:`, `https:`, and `mailto:` are external
and never fetched; other schemes, absolute paths, backslashes, and malformed encoding are invalid.
A query is ignored. Whether the target exists is decided by a `LinkTargetProvider`; the filesystem
provider verifies real paths (a symbolic link out of the content root is `outside`) and exact name
case (a link that only works on a case-insensitive filesystem is `missing`). Any regular file is a
valid target; fragments are validated only for Markdown targets.

`relativeLinkPath` produces POSIX destinations relative to the source page and percent-encodes
whitespace, control characters, and `"#%'()<>?[\]^\`{|}`; Unicode letters stay readable. Its
output resolves back to the same target.

## Tests

Unit tests live in `test/unit`. Besides example-based tests, `links-property.test.ts` checks 200
seeded random documents to make sure link syntax inside code is never reported. Fixtures live in the repository's `fixtures/markdown` directory;
they are neutral and contain Material for MkDocs constructs (admonitions, tabs, snippets, attribute
lists) so that body preservation is tested against realistic content. The fixtures are excluded
from Prettier and from trailing-whitespace and final-newline normalization because their exact
bytes are part of the tests.
