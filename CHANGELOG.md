# Changelog

All notable changes to Lorequill are listed here. Every release has one version for the extension,
the check engine, the CLI, and the GitHub Action. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- Documentation site at <https://lorequill.potamico.org/>, built from `docs/`, with getting started
  and references for the profile, the checks, and the CI Action.
- Extension icon for the Marketplace, Open VSX, and the Extensions view.

### Changed

- The extension is listed in the Marketplace and Open VSX categories "Linters" and "Other"
  instead of only "Other".

### Fixed

- A profile saved while Lorequill was reading it, for example by an editor that empties the file
  before writing it, could leave the folder showing "The profile is empty" until the next change.
  The profile is now read again when it changed during reading.
- The page editor shows text between single tildes (`~text~`) as struck through, as GFM and the
  preview do; before, only double tildes were. The strikethrough button removes both forms.

## [0.2.0] - 2026-11-14

First release. The extension is "Lorequill – Structured Knowledge Documentation", with the
identifier `potamico.vscode-lorequill`.

### Added

- **Repository profile** `.lorequill/config.yaml` with a JSON schema: content root, include,
  exclude, and draft patterns, base branch, page collections with fields, widgets, templates, and
  defaults, stable links, and check rules. Profiles are data only. With the YAML extension, VS Code
  completes and validates the profile while you type.
- **Pages** view with titles from front matter, first heading, or file name, **Filter Pages...**,
  **New Page** with collection templates, and a **Draft** mark for pages in `content.drafts`.
- **Page editor** based on CodeMirror 6 over VS Code's text document: Edit, Both, and Preview
  modes, a Source toggle, a formatting toolbar, live preview for Markdown and Material for MkDocs
  constructs, find and replace, the Outline view, and native save, undo, and Auto Save.
- **Properties** view for front matter edits that keep comments, unknown keys, and the body.
- **Insert Link** and link completion with relative `.md` paths and heading anchors that match
  Python-Markdown, in the Lorequill editor and the text editor.
- **Link updates on move**: moving or renaming pages, assets, or directories in VS Code updates
  the relative links to them and in them (setting `lorequill.links.updateOnMove`).
- **Copy Stable Link**: copies an address from the page's id that keeps working when the page
  moves.
- **Check engine** with the rules `relative-links`, `forbidden-text`, `unique-field`,
  `allow-values`, `field-format`, and `reference-field` (for example a required successor of a
  retired page), a language server for diagnostics of saved and unsaved pages, **Check Pages**,
  the `lorequill-checks` CLI with text, JSON, and SARIF 2.1.0 output, and run-level timeouts and
  limits. Links from published pages to drafts are reported.
- **Commit** with the commit check on the staged tree, whole-file staging through the normal Git
  index, verification against hooks that change the commit, and **Check Commit**.
- **Submit for Review**: push without force and one GitHub pull request per branch, on github.com
  or GitHub Enterprise Server, with idempotent retries and no reopening of closed reviews. On the
  base branch, it offers to create a branch for the changes and returns the local base branch to
  the remote state.
- **Lorequill checks Action** for GitHub Actions: a pinned, reproducible bundle that runs no
  repository code, annotates findings, and writes SARIF. **Show Version** compares the editor's
  engine with `checks.engine_version`.
- **MkDocs example hook** that turns stable links into redirects, lists all of them on an index
  page with copy buttons, and takes retired pages out of the navigation with a notice that links
  their successors.
- English and German (Swiss spelling) interface, following the VS Code display language.
- User guide, specification, decisions, privacy notice, release procedure, and acceptance
  traceability.

[Unreleased]: https://github.com/potamico/lorequill/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/potamico/lorequill/releases/tag/v0.2.0
