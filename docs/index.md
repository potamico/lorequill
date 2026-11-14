# Lorequill

Lorequill turns a Git clone of a Markdown documentation repository into a writing environment in
Visual Studio Code. Authors browse and edit pages, edit front matter in a form, check links and
metadata, commit on their branch, and submit the branch for review as a GitHub pull request. The
repository stays the only source of truth: Lorequill uses normal files, the normal Git index, and
normal commits.

It is made for docs-as-code knowledge bases built with MkDocs and Material for MkDocs.

## What it does

- **Pages** view of the documentation, with titles, aliases, and a filter.
- **Page editor** with live preview of Markdown and Material for MkDocs constructs, a rendered
  preview, and VS Code's native save and undo.
- **Properties** for front matter, with the fields that the repository's collections define.
- **Links** that are inserted, completed, checked, and updated when pages move.
- **Checks** in the editor and in CI with the same engine, declared in the repository profile.
- **Commit and Submit for Review** from the editor, with a check of exactly what is committed.

## Install

- [Visual Studio Marketplace](https://marketplace.visualstudio.com/items?itemName=potamico.vscode-lorequill)
  for VS Code.
- [Open VSX](https://open-vsx.org/extension/potamico/vscode-lorequill) for VSCodium and other
  editors based on VS Code.
- The VSIX of every release is attached to the
  [GitHub releases](https://github.com/potamico/lorequill/releases).

Then follow [Getting started](getting-started.md).

## Learn more

- [User guide](user-guide.md): everything an author does with Lorequill.
- [Profile](reference/profile.md), [checks](reference/checks.md), and
  [CI](reference/ci.md) reference for maintainers of a documentation repository.
- [Stable links with MkDocs](examples/mkdocs/README.md): addresses that keep working when pages
  move.
- [Privacy](privacy.md): what Lorequill stores, logs, and sends.

Lorequill is open source under the Apache License 2.0. The source, the specification, and the
development guide are on [GitHub](https://github.com/potamico/lorequill).
