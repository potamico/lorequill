# Specification: Lorequill — Structured Knowledge Documentation for Visual Studio Code

**Project:** Lorequill (`lorequill`) — open-source project  
**Example target repository:** EA Body of Knowledge (separate example profile)  
**Status:** Normative specification of the product. Decisions that refine it are in [`decisions.md`](decisions.md).

## Project identity and distribution

- **Product name:** Lorequill
- **Extension display name:** Lorequill – Structured Knowledge Documentation (the Marketplace
  reserves the shorter name)
- **Full project name:** Lorequill — Structured Knowledge Documentation for Visual Studio Code
- **Git repository:** `potamico/lorequill`
- **Packages:** `@lorequill/*` workspace packages in one monorepo; they are bundled into the
  extension and the Action and are not published to npm.
- **VS Code extension identifier:** `potamico.vscode-lorequill`, on the Visual Studio
  Marketplace and on Open VSX
- **GitHub Action reference:** `potamico/lorequill/action@<commit SHA>`
- **License:** Apache License, Version 2.0 (`Apache-2.0`), for all original Lorequill source code and first-party packages. The license decision is final for this specification.
- **Community files:** `README.md`, `LICENSE`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md`, and a reproducible release procedure (`docs/release.md`). `LICENSE` contains the complete, unmodified Apache-2.0 license text. Every published first-party npm package declares `"license": "Apache-2.0"` in `package.json`; the extension manifest uses the same license identifier. Preserve required third-party license notices and include a `NOTICE` file when applicable. `CONTRIBUTING.md` states that contributions are submitted under Apache-2.0, subject to any applicable third-party rights. No contributor license agreement is required for the MVP.

Apache-2.0 permits commercial and proprietary reuse without requiring publication of modifications; redistributors must comply with its license, notice, and modification-notice conditions. This specification does not add copyleft obligations.

The name Lorequill is a product naming decision, not a claim of trademark clearance.

## 1. Purpose and boundaries

An author opens a trusted local Git clone in Visual Studio Code, browses Markdown pages, edits their body in a CodeMirror-based custom text editor, and edits YAML front matter in a properties panel. The repository remains the only source of truth. A declarative repository profile defines page collections and checks. The same check engine runs locally and in CI. Authors save locally, validate changes, commit staged changes to the current Git branch, and submit that branch for review on GitHub (with GitLab support planned for a later release).

This is a VS Code extension, language server, and reusable check engine, not a web application, wiki, graph database, site generator, or replacement for MkDocs/Zensical. Repository-specific content and paths are supplied by the repository profile.

### Core principles

- **Native workspace:** One ordinary Git working tree and its currently checked-out branch per repository. There is no branch per page, per editor tab, or per user identity imposed by this extension.
- **Multiple-page editing:** Any number of pages can be open and modified concurrently. A single commit can include multiple staged pages.
- **Native save semantics:** Saving a document only writes its current buffer to disk. It does not run checks, switch branches, commit, push, or create a review.
- **Explicit review workflow:** Validation, commit, and submission are separate actions with visible results.
- **Markdown-first:** The files on disk are authoritative; the editor does not maintain a second content model.
- **Safe declarative profiles:** Profiles name built-in rules and constrained parameters. They cannot invoke commands, load scripts, or supply arbitrary regular expressions.
- **Shared checks:** The same versioned check engine and input semantics are used by the editor, CLI, and CI.
- **No extension telemetry:** The extension does not transmit usage analytics or page content to a telemetry service.

## 2. Scope

### MVP (required for first acceptance)

1. Workspace trust, profile validation, and a Pages tree.
2. CodeMirror custom text editor with WYSIWYG-style live-preview editing, source mode, a read-only rendered preview (view modes `Edit` / `Both` / `Preview`), and native save/undo/redo.
3. Properties panel with safe front-matter updates.
4. Create pages, relative Markdown link insertion, and link validation.
5. The declarative check rules and a CLI with CI integration.
6. Diagnostics, explicit **Check**, **Commit**, and **Submit for review** actions.
7. GitHub review integration. GitLab is a separate follow-on milestone, not an MVP acceptance dependency.
8. Correct operation with multiple open and modified pages, unrelated unstaged changes, and an existing Git index.

### Follow-on features (not blocking MVP acceptance)

- Incoming/outgoing link panels and hover previews.
- Unlinked-mention discovery and conversion, including reverse mentions.
- MkDocs navigation notice.
- Live-preview widgets beyond the MVP set of §8.
- A floating formatting toolbar shown next to a text selection.
- Paste as Markdown: converting rich clipboard content (for example from a word processor or browser) into Markdown text on paste.
- Focus mode (dims everything except the current paragraph) and typewriter mode (keeps the current line vertically centered).
- Emoji shortcode completion (`:name:`) for repositories that enable emoji support.
- Rendered-preview support for Mermaid diagrams, math, and footnote hover, using locally bundled libraries in their strictest security configuration.
- GitLab adapter (separate milestone after MVP).

Follow-on features must reuse the same document, parser, path-resolution, and Git contracts. They must not introduce an alternative document store.

### Explicitly out of scope

Real-time collaboration, CRDT, WYSIWYG editing through a separate document model (converting Markdown to a block document and back), inline review comments, graph/canvas, plugin rule marketplace, wikilink authoring, site builds, editing `mkdocs.yml`, `.nav.yml` or images, page rename after publication, automated merge/conflict resolution, heading drag-and-drop, and merging a PR/MR inside the extension.

## 3. Terms and state model

| Term | Definition |
| --- | --- |
| Target repository | The local Git clone containing Markdown pages |
| Workspace folder | A VS Code folder with an independent profile and repository context |
| Profile | `.lorequill/config.yaml` in the repository |
| Content root | Directory containing the managed Markdown pages |
| Page | An included Markdown file under the content root |
| Working branch | The currently checked-out local Git branch |
| Saved | Editor buffer equals the on-disk document |
| Modified | On-disk file differs from the repository's current `HEAD` |
| Staged | File content is in the Git index for the next commit |
| Checked | A specific immutable content snapshot has passed the configured checks; the snapshot identity is retained with the result |
| Editable page | An included Markdown file offered in the Pages tree and managed editor |
| Valid link target | A resolvable regular file within the content root, including excluded Markdown files and non-Markdown files such as PDFs; fragments are validated only for Markdown targets |
| Check scope | Included pages, plus any other files expressly required by a built-in rule for reference resolution |
| Committed | Selected content has been committed to the current branch |
| Submitted | A PR/MR exists for the branch and its relevant commits have been pushed |
| Finding | Rule ID, severity, message, relative file path, line, and optional column |

The editor's document save status is separate from Git status. A document can be saved locally while modified, uncommitted, and not submitted. No single `Saved` label is used to imply a Git commit.

## 4. Installation and architecture

The author installs VS Code, Git, and this extension, opens an existing clone, trusts the workspace, and authenticates to a supported Git host only when a remote operation is needed. Python, GitHub CLI, and a second VS Code extension are not required. The extension bundles the language server and editor assets. Readers can use the Git host without installing anything.

```text
Visual Studio Code
  Extension
    Lorequill view container (Pages tree, Properties view)
    CodeMirror CustomTextEditorProvider
    Check / Commit / Submit commands, status bar item
    Git adapter (VS Code Git extension API plus Git binary plumbing)
    Host adapter (GitHub; GitLab later)
  Language server (separate Node process)
    Profile validation and collection metadata
    Front matter and Markdown parsing
    Link resolution and diagnostics
    Shared check engine
Target repository
  .lorequill/config.yaml
  docs/**/*.md
  Existing Git working tree, index, and branch
CI
  Pinned check-engine action / image
```

One language-server process can serve multiple workspace folders, but each folder has independent profile, document, index, and repository state. Nested or overlapping repositories must be resolved to their actual Git root. No operation may accidentally cross a workspace-folder or content-root boundary.

The language server is not registered as a replacement for the built-in Markdown language service. The custom editor supplies its own visual editing surface; the built-in editor and preview remain available through **Reopen Editor With…**. The built-in Outline is not expected to reflect the custom webview editor.

The custom editor is registered with priority `option`, not as the default editor for all `*.md` files, so README files and Markdown outside the profile's content scope keep the built-in editor. Pages opened from the Pages tree open in the Lorequill editor. For a page in content scope, an editor-title action switches between the Lorequill editor and the text editor. Authors who want the Lorequill editor everywhere can use VS Code's standard `workbench.editorAssociations` setting.

All Lorequill views live in one Lorequill view container in the activity bar: `Pages` (Pages tree), `Properties` (Properties view), and `Outline` (page outline). Authors can move these views, for example into the secondary side bar, with VS Code's standard view management.

User-interface text follows the VS Code display language through the extension's translation catalogs, with English as the fallback; the German catalog uses Swiss spelling and serves every `de` display language. The profile `locale` does not change the interface language. It applies to content that Lorequill writes into the repository, such as the default commit message and minimal page templates, and to date display in the Properties view. German labels in this specification are the German catalog strings.

## 5. Project structure and technology

```text
lorequill/
  packages/profile/       JSON Schema and generated types
  packages/checks/        Pure check engine, CLI, SARIF output
  packages/markdown/      Shared Markdown parser, link and anchor resolver
  packages/editor/        CodeMirror editor, no VS Code dependency
  packages/server/        Language server
  packages/extension/     VS Code extension, webviews, Git/host adapters
  action/                 GitHub Action using packages/checks
  fixtures/               Markdown, YAML, link, and Git integration fixtures
  package.json            npm workspaces
```

Use TypeScript in strict mode, Node.js in a runtime supported by the selected VS Code and CI environments, CodeMirror 6, an established CommonMark/GFM parser that provides exact source positions for every node (`micromark` with `mdast-util-from-markdown` and its GFM extensions) rather than a hand-written parser, `yaml` with document-level parsing, Ajv with JSON Schema Draft 2020-12, and a pinned test/build toolchain. `vscode-languageclient`, `vscode-languageserver`, the LSP protocol version, and the exact TypeScript/CodeMirror versions are chosen and locked after a compatibility check; package versions from an earlier draft are not automatically normative. Use `esbuild` for VSIX bundles and Vitest for unit and fixture tests. The extension and CI package must identify their actual check-engine version in results.

Git operations must use a structured API or argument-array process execution, never shell-string concatenation. The Git adapter combines both: it uses the VS Code Git extension API for repository discovery, status events, staging and unstaging, and push (so VS Code's credential handling applies), and it invokes the Git binary reported by that API, with explicit arguments and a verified working directory, for plumbing the API does not offer (index tree identity, staged blob reads, commit tree verification) and for the commit itself. After every Git change the adapter asks the Git extension to refresh, so the Source Control view stays current. Never execute code or Git hooks supplied by the target repository as part of check evaluation. Git's normal hook behavior during commits must be documented and must not be mistaken for check-engine behavior.

## 6. Repository profile

The file `.lorequill/config.yaml` is required. A missing, unsupported, or invalid profile disables managed editing for that folder and shows one actionable, localized message. Profiles are parsed as data and validated against a closed JSON Schema before any rule is executed. Unknown keys and unknown rules are rejected. TypeScript profile types are generated from the schema.

```yaml
version: 1
locale: de-CH

content:
  root: docs
  include: ["**/*.md"]
  exclude: ["**/index.md"]

review:
  base_branch: main

checks:
  timeout_seconds: 30
  rules:
    - id: broken-links
      rule: relative-links
      anchors: true
      slugify: unicode

collections: []
```

### Profile rules

- Version 1 inserts relative Markdown links with `.md` destinations. These are fixed product behaviors, not profile options.
- Each check has a unique `id`, a built-in `rule`, and only that rule's declared parameters. A single bounded `checks.timeout_seconds` value (default 30) applies to an entire check run; per-rule timeouts are not part of profile version 1. `argv`, executable paths, shell expressions, arbitrary regexes, and other unknown parameters are invalid.
- `collections` are optional. Without a matching collection, existing front matter is shown in a generic editor and unknown keys are preserved.
- A collection's `folder` is matched against the exact directory relative to the content root after safe expansion of `{domain}`. The domain is the first path segment under the content root. A folder is never silently rewritten to a different collection folder.
- New pages use the single matching collection, allow selection when several match, or use a minimal title/heading template when none match. Multiple collection matches must be resolved explicitly; collection IDs must be unique.
- Field defaults apply only when creating a page or explicitly adding a missing field, never silently to existing files.
- Required fields cannot be silently removed by an automatic cleanup. Explicitly cleared optional known fields are omitted from front matter; existing unknown fields are preserved. Unknown fields retain their values. `required: true` is a form-level indicator, not an implicit commit-blocking check: incomplete drafts may be saved and committed unless an explicit built-in rule rejects them. The panel shows missing required fields without inventing additional check rules.
- `content.drafts` optionally lists glob patterns, relative to the content root like `include` and `exclude`, for drafts: files that are checked like other pages but not published by the site build. A draft page stays an included page; the Pages view marks it, and `relative-links` reports links from pages that are not drafts to any draft file (`relative-links/target-is-draft`). The site build must leave the same files out of the published site; Lorequill does not configure it.
- The `review` section specifies the target base branch; the active Git remote and branch determine the host review operation.
- Profile changes invalidate cached checks, link indexes, and collection metadata.
- All interface strings use translation catalogs with English keys and English and German (Swiss spelling) catalogs. The interface language follows the VS Code display language (§4); `locale` controls repository-facing content only.

## 7. Document model, save, and concurrency

The VS Code `TextDocument` is the canonical in-memory document. CodeMirror is its editing view, not a separate authoritative file store. The custom editor sends versioned edits to the extension; the extension applies them to the text document. Document changes (including undo, redo, external edits, and property edits) are reflected back into CodeMirror without echo loops. Stale webview updates are rejected or reconciled against a known document version; no last-writer-wins full-document overwrite is allowed. Webview reload, panel recreation, extension restart, and editor reopening reconstruct the view from the current `TextDocument`. No acknowledged edit may exist solely in webview memory. On external disk changes, VS Code's document/conflict handling remains authoritative; the extension does not silently replace a dirty buffer.

**Save** means VS Code's ordinary document save: `Ctrl+S`, File > Save, Auto Save, and the toolbar's `Save` use the same native mechanism. Save does not run checks, stage, commit, push, switch branches, or create PRs. A failed check never prevents local saving. Unsaved buffers remain recoverable through the normal VS Code document lifecycle.

The properties panel edits the front matter using a version-checked `WorkspaceEdit` against the current document. Such edits participate in the document's undo/redo history. Concurrent changes in the body and front matter must not overwrite one another. A stale edit is retried against the latest document or rejected with a visible conflict message.

The interface displays document status (`Not saved` / `Saved locally`) and separate Git/review state (`Changed`, `Ready to commit`, `Committed`, `Submitted for review`, `Conflict`). A submitted review is not represented as a property of an individual page when several pages share the same branch.

Diagnostics for the editing snapshot, including unsaved buffers, update automatically after a short pause in typing and on save, using the incremental index; they appear in the Problems view and inline in both the Lorequill editor and the text editor. The visible `Check Pages` command runs a complete check of the editing snapshot on demand, shows a summary, and clearly labels this as **editing state**. `Commit` automatically performs a separate **commit check** on the staged Git tree; its result cannot be reused from editor diagnostics. **Commit** uses the existing Git index, not unsaved editor buffers. The author saves intended changes before committing and selects files to stage in the commit dialog or through standard VS Code Git commands. The staged snapshot is validated, and a changed index requires validation again.

## 8. Pages and editing interface

The Pages tree (`Pages`) lives in the Lorequill view container (§4) and shows included directories/pages. Labels come from front matter `title`, otherwise the first Markdown heading, otherwise the filename. Filtering searches title, filename, and string aliases. Excluded pages do not appear in this tree, but exclusion from editing does not by itself make a legitimate repository link invalid.

The page outline (`Outline`) is a native tree view in the same container, below `Pages`. It shows the headings of the page in the active Lorequill editor, nested by level and taken from the same syntax tree as anchors (§10), so front matter and code blocks never produce entries. It updates shortly after typing pauses. Selecting a heading moves the editor's cursor to that heading and scrolls it to the top; moving the cursor selects the heading of the current section. The built-in Outline view does not cover custom editors, and the outline is empty while no Lorequill editor is active.

A directory's plus action creates a page in that exact directory. The author supplies a title and always sees an editable proposed filename (`File name`). A collision with an existing file, invalid filename, or path escape is rejected. Filename changes after publication are out of scope; ordinary Git file operations outside the extension remain possible and must not corrupt its state.

The custom text editor uses CodeMirror 6 and offers three view modes, selected through a segmented control in the toolbar (`Edit` / `Both` / `Preview`) and through commands:

- **`Edit`** (default) is WYSIWYG-style live-preview editing inside CodeMirror. Markdown syntax is hidden or replaced by decorations and widgets, and revealed for the construct that contains the cursor or selection. The MVP set covers headings, emphasis, strikethrough, inline code, links, bullet and numbered lists, task-list checkboxes, quotes, horizontal rules, fenced code blocks with syntax highlighting, Material for MkDocs admonitions, and tables. Toggling a checkbox is a single-character text edit. A top-level table is rendered as an editable grid: a click edits a cell, which shows its own Markdown text in a one-line input while the other cells stay rendered, and every keystroke writes the cell's text into the document. Tab and Shift+Tab move to the next and previous cell, Tab in the last cell adds a row, Enter adds a row below, Enter in an empty last row ends the table, the arrow keys move between cells and out of the table, and Escape returns to the text after it. Typed pipes are escaped, and leaving a cell realigns the table's source. A selection that covers part of a table, such as a search match, shows its source. In the Markdown source of a table, as in `Source`, Tab, Shift+Tab, and Enter move between cells and add rows in the same way. Unknown or unsupported constructs are shown as source, never hidden or reinterpreted.
- **`Both`** shows the same editor as `Edit` (live preview, or source with `Source`) beside a read-only rendered preview, with synchronized scrolling in both directions. On narrow editor widths it falls back to `Edit`.
- **`Preview`** shows only the read-only rendered preview.

A separate `Source` toggle in `Edit` and `Both` removes all decorations and shows the raw front matter. In every mode the text document is the only content model: the editor never converts Markdown to a block document and back (§9), every edit is a text edit of the affected range, and switching modes or toggles never reparses and serializes the whole document or modifies it. The front matter is visually hidden in live preview and in the rendered preview but remains in the text document.

The rendered preview approximates the target site. It is rendered from the same syntax tree as link extraction (§10), with a sanitizing HTML serializer and documented extensions for the supported Material for MkDocs constructs, so preview, scroll synchronization, completion, and checks cannot disagree about the document's structure. It is labelled as an approximation; the site build remains authoritative. It renders no raw HTML, loads no remote resources, executes no scripts from page content, and resolves relative links and images only inside the content root. Activating a relative page link opens the target page; external links open only through VS Code's standard external-link confirmation.

Formatting commands cover heading levels 1–3, bold, italic, strikethrough, inline code, bullet, numbered, and task lists, quote, fenced code block, horizontal rule, insert table, and insert link. Toggles must be syntax-aware: a second invocation removes formatting only when the selection is actually wrapped in that syntax. Unsupported/ambiguous selections must not be destructively rewritten. Table tools insert rows above or below and columns left or right, delete the current row (never the header) or column (never the last one), set the current column's alignment, and realign the table. They rewrite only the table containing the cursor, as one undoable edit, keep every cell's text, and leave a table unchanged when a row has more cells than its header, because GFM would drop them. The list type of the current list (bullet, numbered, task) can be changed through a command and the context menu.

Smart input assists typing without rewriting existing text: Enter continues the current list or task list and an Enter on an empty item ends it; Tab and Shift+Tab indent and outdent list items; brackets, backticks, and paired emphasis markers are closed automatically. Each assist is one undoable text edit. Inside a Markdown link destination, completion suggests editable pages as relative `.md` paths and, after `#`, the heading anchors of the target page, using the same parser and path resolver as Insert Link and the checks (§10). The typed text is matched, ignoring case, against the path, the page title, and the aliases (for anchors: the anchor and the heading text), so a page is found by its title even when its path differs. The same completion is offered in VS Code's text editor for Markdown pages in the content root, outside front matter, code, and raw HTML.

Ctrl+click (Cmd+click on macOS) on a link follows it in every mode: the destination is resolved like the `relative-links` check resolves it, relative to the page and inside the content root. A page opens in the Lorequill editor and jumps to the heading of a fragment (both anchor algorithms of §10 are accepted); other repository files open in VS Code; `http:`, `https:`, and `mailto:` links go through VS Code's external opener; anything else, and missing targets, produce a message instead of an action.

The editor provides its own find and replace (`Ctrl+F`, `Ctrl+H`) over the whole document, with case, whole-word, and regular-expression options, styled with VS Code theme colors. The webview find widget is not sufficient because it only sees rendered lines. Regular expressions entered by the author are used only for this local search, never by the check engine. In `Edit`, the text column has a configurable maximum width for readability (`lorequill.editor.maxTextWidth`).

The editor follows the VS Code settings for editor font size and tab size and uses VS Code theme colors throughout. `Edit` uses a reading layout modelled on rendered Markdown: the proportional VS Code interface font, always-wrapped lines in a centered text column whose maximum width is set by `lorequill.editor.maxTextWidth` (pixels, `0` for the full width), headings with rules below levels 1 and 2, indented lists, quotes with a side bar, and code on a shaded background in the editor font. `Source` shows the plain source in the editor font family and follows the word-wrap setting. Editor commands are VS Code commands; their default keybindings (for example `Ctrl+B`, `Ctrl+I`, `Ctrl+F`) are contributed with a `when` clause limited to the active Lorequill editor, so they do not change VS Code's behavior elsewhere and can be rebound in Keyboard Shortcuts. The toolbar and widgets are operable by keyboard, have accessible names, work in high-contrast themes, and keep CodeMirror's screen-reader support.

The writing toolbar offers undo and redo, formatting, link and table insertion (in a table, the table button opens the table tools), the view-mode control, the `Source` toggle, `Save`, `Check Pages`, `Commit`, and `Submit for Review`. Undo and redo invoke VS Code's native undo and redo on the text document; the editor keeps no separate undo history, so typing, formatting commands, live-preview edits, and properties-panel edits share one history. Toolbar icons use VS Code codicons and theme colors. Line, column, word count, estimated reading time, and document save state are shown in the VS Code status bar. All commands are accessible through the command palette and keyboard. The Git actions operate at repository scope, not only on the currently visible page; `Commit` and `Submit for Review` are also contributed to the title bar of the Source Control view. A staged-change review shows exactly which files and changes are currently staged. The commit dialog uses native VS Code UI rather than a webview: a multi-select quick pick lists staged and unstaged files, where selecting or clearing a file stages or unstages it through the normal Git index, and a per-file button opens VS Code's diff editor; an input box takes the commit message. Existing staged files remain staged by default and are visibly marked; the author confirms the complete staged set before committing. Partial staging is preserved when already present in Git, but the MVP dialog need not implement hunk-level staging. The Git index is the sole staging state.

The Properties panel is a webview view (`Properties`) in the Lorequill view container. It follows the active page, whether that page is open in the Lorequill editor or in the text editor, and shows an empty state otherwise. In live preview, where front matter is hidden, a compact properties line at the top of the page reveals the Properties view. The Properties panel marks missing required fields but does not prevent local Save or automatically block Commit; only an explicit check rule can block Commit. The Properties panel supports `string`, `text`, `select`, `list`, `boolean`, `date`, and `hidden`. A boolean stores a YAML boolean; a date stores a quoted `YYYY-MM-DD` string. Hidden fields are not displayed. Unknown front matter keys are preserved and accessible through a generic fallback view.

## 9. Markdown and YAML preservation

The editor never converts Markdown to a block document and back, and never reformats an entire file merely because it was opened or saved. The body is changed only by explicit text edits or formatting commands. An edit to front matter must not alter body text, line endings, or trailing whitespace. Existing Markdown constructs outside the edited selection—including Material for MkDocs admonitions, tabs, snippets, attribute lists, task markers, and code blocks—remain intact.

**Byte-for-byte identity is not required for YAML.** The requirement is semantic preservation: existing values, unknown keys, comments where the YAML library can retain them, and ordering where practical. Updating a field may normalize formatting in the affected YAML region. This is acceptable, provided unrelated fields and the Markdown body are not changed semantically. Tests must check preservation of values, comments in common cases, and unchanged body content. When YAML cannot be parsed safely or contains unsupported constructs, the panel becomes read-only for that file; source editing remains available.

YAML is read and modified with document-level parsing (`parseDocument` and node edits), not plain-object parse/stringify for writing. Duplicate keys, invalid syntax, unsupported tags, and ambiguous values must produce a clear diagnostic rather than a silent rewrite. No YAML tag may execute code.

## 10. Slugs, Markdown links, and anchors

A new filename is derived from its title: `ä→ae`, `ö→oe`, `ü→ue`, `ß→ss`, lowercase, spaces to hyphens, unsupported punctuation removed, repeated hyphens collapsed, and leading/trailing hyphens removed. `Identität` becomes `identitaet`; `Metadata Schema` becomes `metadata-schema`. Unicode normalization, collisions, reserved filenames, and empty results are handled deterministically; the author can always correct the proposed filename before creation.

All link-related features share one parser and resolver in `packages/markdown`. The parser must recognize CommonMark inline links, full/collapsed/shortcut reference links and definitions, fragments, optional link titles, escaped delimiters, angle-bracket destinations, and percent-encoded paths. GFM task lists and fenced code are supported for correct link exclusion. Material for MkDocs container blocks (admonitions `!!!`, collapsible blocks `???` and `???+`, content tabs `===`) are recognized as containers: their indented body is parsed as nested Markdown, not as an indented code block, so links inside them are found and checked. They introduce no additional link syntax in MVP; snippet includes (`--8<--`) are preserved but not followed. Unsupported extension-specific link constructs are not guessed. Images are not treated as navigable page links in version 1. Links inside code blocks or inline code are ignored. Unsupported syntax is not guessed from a naive regular expression.

Insert Link searches page titles, fallback first headings, and string aliases, then inserts a POSIX-style path relative to the source file, with `.md` extension and appropriately encoded target/fragment. The display text is editable. Page search offers **editable pages** (matching `include` and not `exclude`). The resolver may validate **link targets** anywhere under the content root, including excluded Markdown files. Repository checks evaluate **included pages** as sources; excluded files can be read as targets for existence and anchor validation but are not independently checked by other rules. These three scopes are distinct and shared by editor, CLI, and CI. Targets outside the content root, nonexistent files, unsupported schemes, and absolute filesystem paths are rejected according to the rule contract. External `http:`, `https:`, and `mailto:` links are accepted but never fetched by the extension.

Fragment-only links refer to the current file. Heading anchors are calculated by a deterministic, tested algorithm selected by `slugify: unicode|ascii`, with duplicate suffixes `_1`, `_2`, etc. Explicit identifiers in attribute-list syntax (`{#id}`, `{ #id }`, or `{: #id .class }`) take precedence as the heading's anchor; they are not assumed to create an additional automatic anchor. The implementation must document normalization and punctuation handling, and test compatibility with the first target site's actual renderer. If the site's configured anchor algorithm differs, `mkdocs build --strict` remains the authoritative build check; the extension must not claim perfect parity.

All paths are resolved against the correct source file, normalized, checked for traversal, and verified against real paths/symlinks where filesystem access is involved. A relative path with `..` is valid when its normalized destination remains inside the content root; `..` is not rejected categorically.

When files or directories below the content root are moved or renamed in VS Code, the extension rewrites the destinations of relative links and images that point to them, and the relative destinations inside moved pages, so that each still resolves to the same file; link text, titles, queries, and fragments stay as written. Changed pages are saved unless they already had unsaved changes. Moves outside VS Code are left to the `relative-links` rule. The optional profile section `site` declares the published site URL and stable links: a front matter field and a path with a `{value}` placeholder. **Copy Stable Link** copies that address for a page; producing the matching redirects is the job of the repository's site build (an informative MkDocs hook is provided).

### Follow-on link navigation

Hover previews show a target title and short body excerpt without fetching remote URLs. Outgoing links follow the current unsaved buffer. Incoming links are indexed from eligible Markdown files and updated incrementally on file or document changes. Heading navigation follows the current buffer. Mentions are whole-name, case-sensitive occurrences of titles/aliases of at least three characters, excluding code, URLs, and existing links. Ambiguous names require explicit target selection. Replacements are ordinary undoable document edits, never automatic commits. Indexes must have cancellation, invalidation, and bounded-memory behavior.

A later navigation notice may inspect plain `mkdocs.yml` without evaluating custom tags or executing code. It never edits navigation and never blocks commits.

## 11. Check engine

### Contract

The engine receives an immutable logical workspace snapshot, a validated profile, and an explicit engine version. It returns deterministically ordered findings. A snapshot is a read-only file-provider interface over the repository's relevant content, with optional in-memory overrides for open documents. The engine does not need to copy the workspace to a temporary directory. It never executes repository code or mutates files.

Editor diagnostics use a snapshot of the relevant saved files plus versioned unsaved document overrides. CI uses the checked-out files. Identical file bytes, profile, engine version, and normalized paths must produce identical findings; different snapshots are not expected to match. Findings are tagged with document/snapshot versions so stale diagnostics are discarded.

A commit validates the tree represented by the existing Git index, including staged additions, modifications, and deletions alongside unchanged tracked files from `HEAD`. Unstaged working-tree changes and unsaved editor buffers are not part of that tree. The engine reads staged blobs through a read-only Git-backed snapshot provider. If the staged tree changes before commit invocation, the operation is cancelled and must be rechecked. A change during commit execution is detected by post-commit tree verification as described in section 12. The CLI validates the filesystem snapshot passed to it. File iteration and duplicate reporting use sorted normalized relative paths.

Every rule reports `error` in version 1 and blocks **Commit** when the candidate contains findings. Checks do not block **Save**. Timeouts, cancellation, and resource limits must be enforced at run boundaries; a timeout is a failed check, not a successful empty result. The CLI exits `0` for success, `1` for findings, and `2` for execution/configuration errors. Each check result records a stable snapshot identifier and the engine version. Standard output and optional SARIF 2.1.0 output include stable rule IDs and file locations.

### Built-in rules

| Rule | Parameters and semantics |
| --- | --- |
| `forbidden-text` | Non-empty literal substring `text`, at most 200 characters; one finding per matching line. No regex. |
| `unique-field` | Front matter `field`; non-empty scalar values compared after YAML parsing and specified string normalization; duplicate values reported deterministically with the canonical first path. Non-scalar values are a diagnostic. |
| `allow-values` | Literal `marker` and enumerated `values`; checks the trimmed value after the first marker on each applicable line, removing one surrounding backtick pair. |
| `relative-links` | Checks parsed Markdown link destinations, root containment, file existence, supported schemes, optional fragment anchors, and that pages which are not drafts do not link to drafts (`content.drafts`). Uses the shared resolver. |
| `reference-field` | Required `field` and `target` (front matter keys), optional `required` and `when` filter; on pages in scope, each value of `field` (scalar or list of scalars) must equal, after `unique-field` normalization, the `target` value of another included page. Reports missing (with `required`), unknown, self-referencing, and non-scalar references. Used, for example, for the successor of a retired page. |
| `field-format` | Required `field`, letter-only `prefixes` (up to 20 characters each), optional `when` field/value filter; accepts `<PREFIX>-<digits>` and rejects missing/invalid scoped values. |

All rule schemas reject unknown keys. The single run-level `checks.timeout_seconds` is bounded by the profile schema. More complex repository-specific checks remain in the host pipeline rather than becoming arbitrary executable profile parameters.

## 12. Git and review workflow

### Branch model

The extension uses the repository's **currently checked-out branch**. The author creates or switches feature branches through VS Code's standard Git commands. Save, Check, and Commit never switch branches implicitly.

Multiple edited pages can be committed together to that branch, and multiple commits can be submitted in one PR/MR. The extension must not distinguish between editor tabs or authors when forming local branches. A working tree can contain other local changes; unstaged changes remain untouched. Already staged changes are part of the next ordinary Git commit unless the author explicitly unstages them.

### Commit

The `Commit` action operates on the repository's **standard Git staging area (index)**. Authors save files locally and stage or unstage changes using VS Code's existing Git interface or equivalent extension controls. The extension shows the staged file list and makes clear that **every staged change** will be committed, including changes outside the managed Markdown content root. The commit dialog can stage or unstage whole files via the ordinary Git index. It never silently stages, unstages, resets, or discards changes. If unrelated files are already staged, the author must explicitly confirm their inclusion or unstage them before proceeding. A commit with an empty index is not offered. Files outside the managed content root may be included in a commit, but repository checks cover only their declared scope; the UI makes that limitation explicit.

The engine checks the exact staged repository tree, not the unsaved buffers or the current working-tree files. The profile's checks apply to the configured content scope within that tree. The extension obtains a read-only snapshot from Git's existing index and verifies that `HEAD` and the staged tree identity have not changed between validation and commit. If either changes before commit invocation, it cancels and requests a fresh check. After the normal commit succeeds, it compares the resulting commit tree ID with the validated staged tree ID. If they differ (for example because another Git process or a hook changed the index), it reports **Commit not verified**, blocks Submit, and requires a fresh check of the committed tree (using the same read-only snapshot interface) before submission; it does not attempt to undo or rewrite the commit. If that check fails, the author must make a corrective commit before submission. A matching tree ID verifies content identity, not necessarily that external CI checks have passed. It invokes the normal Git commit mechanism against the existing index. The normal Git commit may run repository hooks; these are distinct from the declarative check engine and must be documented. A hook failure is reported without deliberately discarding staged changes; hook side effects are not under the extension's control and are surfaced through refreshed Git status.

Commit messages default to a concise repository-level description such as `docs: update content`, editable before confirmation. A user may make several commits on the same branch. A successful commit includes the entire staged index, even when it contains changes unrelated to managed pages. The default review workflow is branch-wide, not limited to the last commit. CI remains the authoritative check of the pushed branch and may run additional repository-specific checks.

Deleting a managed page is a normal, explicit filesystem change. The deletion is staged through the standard Git index and validated as part of the staged tree. Missing referenced pages may cause link checks to fail and block the commit. Existing staged changes are never silently removed to make checks pass.

### Submit for review

`Submit for Review` checks that the current branch is not the configured base branch (on the base branch, it offers to create and check out a new branch at `HEAD` and continues only with the author's consent; the local base branch then returns to the remote base branch, since its commits are on the new branch), identifies the configured remote and base branch, confirms the destination, pushes the branch, and creates a PR/MR if none exists for the same source branch and target. If an open review exists for the same source repository/branch and target branch, it reuses that review; it never creates a duplicate. If a prior review is closed or merged, the extension does not automatically reopen it or reuse its identity: it explains the state and requires a new branch or an explicit host-supported recovery outside the MVP. Submission does not automatically merge or delete a branch. A failed push or API call leaves local commits intact and supports a safe retry without duplicate reviews.

A remote update or divergence is handled through standard Git conflict reporting. The extension never silently force-pushes, rebases, resets, or merges; the only reset is the consented branch-off from the base branch described above, which loses no commit. A PR/MR may include all commits on the branch relative to the base, not only files selected in the latest commit; the interface must show or explain this before submission. The user or host handles approval, merge, and branch deletion.

### Git status and error handling

A Lorequill status bar item shows the repository-level review state (last check and commit-verification result, **Commit not verified**, PR/MR link) separately from document save state. The current branch and pending changes are not duplicated: they remain in VS Code's built-in Git status bar item and Source Control view. Detached `HEAD`, unborn branches, absent remotes, protected base branches, staged changes, branch divergence, authentication failures, and concurrent Git operations produce explicit messages and no destructive fallback. A checkout performed externally triggers refresh of open-document and repository state.

## 13. Authentication

Local Save, Check, and Commit do not require a Git-host sign-in. Git identity for commits comes from existing Git configuration. Push and review creation require appropriate host credentials.

GitHub uses VS Code's built-in `github` authentication provider and the REST API; GitHub Enterprise Server uses the `github-enterprise` provider with the same adapter. Push runs through the VS Code Git extension, so existing Git credentials and VS Code's credential prompts apply. GitLab uses a host-specific adapter with a documented OAuth/session flow or an explicitly supplied access token stored only in VS Code Secret Storage. Do not claim that GitLab needs no personal token unless the implemented authentication flow actually avoids it. Credentials are never stored in the profile or logged. The host and repository are resolved from a verified remote and shown before remote writes.

## 14. CI integration and versioning

The target repository owns the profile and workflow, not the check-engine source. The extension bundles a particular checks package version. The GitHub workflow uses a pinned immutable Action commit SHA or immutable release artifact, not a mutable `@v1` tag described as pinned. GitLab runs an equivalently pinned image/digest. Both print their engine version.

```yaml
name: Lorequill checks
on:
  pull_request:
jobs:
  checks:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@<PINNED_COMMIT_SHA>
      - uses: potamico/lorequill/action@<PINNED_COMMIT_SHA> # Lorequill vX.Y.Z
```

The SHA placeholders stand for the full commit SHAs of the release tags. CI evaluates the PR checkout and reports findings, optionally as SARIF when the host supports upload. An editor and CI running different engine versions may produce different results; the UI must expose version mismatch rather than promising unconditional equivalence. The profile may declare the engine version that CI runs in the optional `checks.engine_version`, kept in step with the pinned Action; the extension shows a notice when its bundled engine differs.

## 15. Security, privacy, and performance

- Start the language server only in trusted workspaces. Read-only explanatory UI may be shown otherwise.
- Validate profiles with a closed schema. Never execute repository scripts, profile commands, arbitrary regexes, or unsafe YAML tags in the check engine.
- Enforce path containment using normalization and realpath/symlink checks; prevent cross-root reads and writes. Reject unsupported special files and unsafe filenames.
- Webviews use a restrictive Content Security Policy, nonce-controlled scripts, escaped content, validated message schemas, and VS Code resource URIs. Treat Markdown and front matter as untrusted input. The rendered preview and live-preview widgets never render raw HTML from page content, load remote resources, or execute page-supplied scripts.
- Define measurable, configurable test-fixture budgets for file size, indexed-page count, parser depth, finding count, memory consumption, and check duration. Initial acceptance fixtures include 1,000 Markdown pages and a 1 MiB page; on the reference CI machine, initial index/check completes within 30 seconds and editing a single page does not require a full index rebuild. Exceeding configured limits produces an explicit incomplete/failed status, never a pass. Cancel stale indexing/check tasks when document versions change.
- Logs contain operational metadata only, not page bodies, front matter values, tokens, or full diagnostic messages. CI logs and SARIF may contain finding locations/messages and are governed by Git-host visibility; the privacy notice must say so.
- Do not automatically fetch external Markdown links. Host API requests occur only for explicit review actions.
- Validate remote host and target before push/PR creation. Never force-push without a separate, explicit workflow (not part of MVP).
- Locked dependencies and reproducible builds are required. Security and compatibility updates follow a tested release process.

## 16. Acceptance tests

### Profile, documents, and editing

1. Missing, invalid, or unknown-version profiles disable managed editing with a localized explanation.
2. Unknown rule names, `argv`, shell parameters, arbitrary regexes, and invalid rule parameters are rejected.
3. A title edit changes only the intended front matter and does not change the Markdown body.
4. Unknown YAML fields and ordinary comments survive a properties edit; invalid/unsupported YAML is not silently rewritten.
5. Existing alias lists remain lists; dates written by the panel are quoted.
6. Source/live-preview toggles do not modify the document. Material admonitions, snippets, tabs, attribute lists, and task markers survive unrelated edits.
7. `Ctrl+S`, Auto Save, and toolbar Save write locally and never commit, check, push, or change branches.
8. Simultaneous body and property edits are version-safe and undoable; stale webview updates cannot overwrite newer text.
9. Two or more pages can remain open and modified concurrently without losing edits.
10. An excluded page is absent from the Pages tree but may still be a valid relative-link target under the content root.
11. Creating a page in a chosen directory does not silently move it to a collection subdirectory; collisions are rejected.

### Links and checks

12. `Identität` becomes `identitaet`; `Metadata Schema` becomes `metadata-schema`; `Claim!` becomes `claim`.
13. Insert Link creates a correct relative `.md` path with POSIX separators and appropriate escaping.
14. Inline and reference links, fragments, escaped destinations, URL-encoded paths, and code-block exclusions use the same parser in editor and checks.
15. Relative paths with `..` that remain inside the content root are valid; paths that escape it, including via symlink, are rejected.
16. Missing relative targets are findings; external `https:` links are not fetched or treated as missing files.
17. Unicode and ASCII heading anchors, explicit `{#custom}` identifiers, and duplicate suffixes behave as documented and are compared with the target site's build behavior.
18. All built-in rule types report their documented violations, including duplicate values and invalid prefixed identifiers.
19. Duplicate-field findings are stable regardless of filesystem enumeration order.
20. Editor, CLI, and CI return identical findings for identical snapshot bytes, profile, and engine version.
21. Unsaved-buffer diagnostics are tagged by version; stale findings do not replace newer ones.
22. Timeout, cancellation, malformed files, and resource-limit failures are not reported as successful checks.

### Git and review

23. Saving a page does not create a branch or commit.
24. Two changed pages can be staged and committed together on the current branch.
25. A second commit stays on the same branch without an implicit checkout.
26. Unstaged changes remain untouched and are excluded from the commit; unrelated pre-staged changes are visibly included unless the author explicitly unstages them.
27. A changed Git index or `HEAD` before commit invalidates the check result; if the committed tree differs from the validated tree, Submit is blocked with a visible unverified-commit state (without rewriting history).
28. A failing check blocks Commit but does not block local Save.
29. An existing feature branch can be submitted as one PR containing multiple page commits.
30. The extension does not submit from the base branch or detached `HEAD` without explicit recovery.
31. Failed push/PR creation preserves commits and permits an idempotent retry.
32. Diverged remote branches and externally changed `HEAD` are detected; no silent reset, rebase, or force push occurs.
33. The review destination and all branch changes included in the PR are visible before submission.
34. A commit has the configured Git author identity and the user-approved commit message.
35. A staged page deletion is validated in the staged tree; unrelated unstaged files remain untouched.

### Security and integration

36. An untrusted workspace does not start the language server.
37. A symlink escape and malicious webview message cannot access or modify files outside the allowed root.
38. Secrets and page content do not appear in extension logs.
39. Multi-root workspaces do not mix profiles, diagnostics, indexes, or Git operations.
40. The pinned CI engine reports its version and runs without executing repository-defined code.
41. GitHub end-to-end acceptance works against a disposable test repository; GitLab has a separate equivalent acceptance milestone.
42. `Check Pages` uses unsaved editor buffers; the automatic commit check uses staged blobs, and both contexts are clearly labelled.
43. The commit dialog stages/unstages whole files using the existing Git index and shows pre-staged unrelated changes before confirmation.
44. Missing required collection fields are visible but do not block Save or Commit without a configured rule.
45. A webview reload, extension restart, external file change, and closing during a properties update do not lose acknowledged edits or silently overwrite a dirty buffer.
46. A previously merged or closed PR is not silently reopened or duplicated.
47. Deleting a page is an explicit standard filesystem/Git operation; no special review-delete configuration is required.
48. The parser recognises CommonMark reference-link variants and ignores links inside fenced and inline code.
49. A 1,000-page fixture meets the documented check/index budget; a single-page edit does not force full reindexing.
50. A simulated commit hook changing the staged tree produces a commit-tree mismatch and blocks submission until verification.

### Editor views

51. Switching among `Edit`, `Both`, and `Preview`, and toggling `Source`, never modifies the document or adds undo steps.
52. An edit in `Edit` changes only the edited range; Material constructs, unsupported syntax, and whitespace outside it remain byte-identical.
53. Toggling a task checkbox in live preview changes exactly one character of the text document and is undoable.
54. Toolbar undo/redo and the keyboard shortcuts use the same VS Code history, including properties-panel edits.
55. The rendered preview shows no raw HTML from page content, loads no remote resources, runs no page scripts, and does not resolve links or images outside the content root.
56. In `Both`, scrolling either side keeps the corresponding source line and rendered block aligned within the documented tolerance.
57. Find and replace finds matches outside the visible area, and a replace-all is a single undo step.
58. Enter, Tab, and Shift+Tab in lists and automatic closing of paired markers each produce one undoable edit and never change text outside the current item.
59. Link completion offers only pages and anchors that the shared resolver accepts, and the inserted path matches Insert Link for the same target. It finds a page by path, title, or alias, in the Lorequill editor and in the text editor.
60. Lorequill editor keybindings apply only while the Lorequill editor is active; elsewhere `Ctrl+B` and the other defaults keep VS Code's behavior.
61. Links inside Material admonitions, collapsible blocks, and content tabs are found and checked; their indented bodies are not treated as code.
62. The interface language follows the VS Code display language regardless of the profile `locale`; the profile `locale` only affects repository-facing content.
63. Opening a Markdown file outside the content scope uses the built-in editor; pages from the Pages tree open in the Lorequill editor, and the editor-title action switches between both editors.

Unit and fixture tests cover parsing, YAML, slugs, rules, snapshots, and link resolution. VS Code integration tests cover document synchronization, native save, webviews, commands, and multi-root behavior. Git integration tests use disposable local repositories with dirty worktrees, pre-staged files, partial staging, concurrent index changes, commit hooks, and multiple branches. Host API tests use a mock adapter plus a disposable remote integration repository.

## 17. MVP acceptance scenario

An author opens a trusted Markdown repository clone in VS Code. The Pages tree appears. The author opens two pages, edits both bodies in CodeMirror, changes a property in one page, and inserts a relative Markdown link. Native Save writes both documents to disk without a commit or branch change. The author runs `Check Pages`, sees any findings, corrects them, and checks again. `Commit` separately validates the staged snapshot. The author selects both pages in the extension's simple commit dialog, which stages them through the standard Git index, reviews any pre-staged changes and the commit message, and commits the entire index to the currently checked-out feature branch. Unstaged changes remain untouched; any unrelated staged files are visibly included or explicitly unstaged beforehand. The author submits that branch for review; the extension pushes and opens or updates one GitHub pull request. The PR contains the intended branch changes, CI runs the pinned check engine, and the site continues to build after merge. No Markdown body content outside the intentional edits has been changed.

The first target repository supplies its own profile and collection templates. A separate example document illustrates the EA Body of Knowledge without imposing its metadata model on the extension.

**Release gate:** The MVP is not accepted until the Apache-2.0 license and required distribution metadata/notices are present, and native save semantics, multi-page commits, standard-index commit behavior, immutable staged-tree check snapshots, and safe PR submission are demonstrated by automated integration tests.
