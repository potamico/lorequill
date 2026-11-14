# Lorequill

**Structured Knowledge Documentation for Visual Studio Code.**

Lorequill lets authors browse, edit, check, commit, and submit Markdown documentation from a
trusted local Git clone, without leaving VS Code. The repository stays the only source of truth: a
declarative profile, `.lorequill/config.yaml`, defines page collections and checks, and the same
check engine runs in the editor and in CI.

## Features

- **Pages** view: the pages of the content root, with titles from front matter or headings, a
  filter, and page creation in the chosen directory.
- **Page editor** with live preview, formatting commands, and native save, undo, and Auto Save.
- **Properties** view for safe front matter edits that keep comments and formatting.
- **Insert Link** and link completion with relative paths and heading anchors.
- **Check pages** with five declarative built-in rules; findings appear in the Problems view.
- **Commit** with an automatic check of the staged files, and **Submit for review** as a GitHub
  pull request from the current branch.

Lorequill runs no repository scripts. Profiles cannot contain commands, and checks only read files.
In an untrusted workspace, Lorequill only explains what it would do.

## Requirements

- VS Code 1.110 or newer, Git, and a local clone with `.lorequill/config.yaml`.
- For **Submit for review**: a GitHub repository (github.com or GitHub Enterprise Server) and the
  VS Code GitHub sign-in.

## CI

The [Lorequill checks Action](https://github.com/potamico/lorequill/tree/main/action) runs the same
engine in GitHub Actions. Declare its engine version in the profile as `checks.engine_version`;
the Pages view shows a notice when the editor's engine differs.

## Privacy

Lorequill collects no telemetry. It contacts GitHub only when you submit for review. Its log
contains operational metadata only, never page content or tokens. See the
[privacy notice](https://github.com/potamico/lorequill/blob/main/docs/privacy.md) and the
[user guide](https://github.com/potamico/lorequill/blob/main/docs/user-guide.md).

## License

Apache License, Version 2.0. Third-party notices are in `dist/THIRD_PARTY_NOTICES.txt`.
