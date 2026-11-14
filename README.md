# Lorequill

**Structured Knowledge Documentation for Visual Studio Code.**

Lorequill lets authors browse, edit, validate, commit, and submit Markdown documentation from a
trusted local Git clone, without leaving VS Code. The repository stays the only source of truth.
A declarative repository profile defines page collections and checks, and the same check engine
runs locally and in CI.

> **Status: pre-release.** The MVP features are implemented: Pages tree, page editor with live
> preview, Properties view, page creation and links, checks in the editor and in CI, Commit with
> its automatic check, and Submit for review on GitHub. 0.2.0 is the first release; versions stay
> at 0.x until the MVP acceptance. See the [changelog](CHANGELOG.md) and the
> [release procedure](docs/release.md).

## Capabilities

- Pages view for the Markdown files of a repository, with drafts and a filter.
- Page editor based on CodeMirror with live preview, a rendered preview, and a Source mode.
- Properties view for front matter edits that keep comments, unknown keys, and the body.
- Page creation, link insertion and completion, links that follow moved pages, and stable links.
- A shared check engine with six declarative rules, a language server, a CLI, and a GitHub Action.
- **Commit** with a check of the staged tree and **Submit for Review** as a GitHub pull request,
  on the current Git branch.

Lorequill is a VS Code extension, language server, and reusable check engine. It is not a web
application, wiki, graph database, or site generator. Principles such as native save semantics, no
telemetry, and safe declarative profiles are described in the specification.

## Documentation

The documentation for authors and maintainers of documentation repositories is published at
**<https://lorequill.potamico.org/>**: getting started, the user guide, and the reference of the
profile, the checks, and the CI Action. Its source is in [`docs/`](docs/).

For contributors, the repository also has:

| Document                                 | Purpose                                |
| ---------------------------------------- | -------------------------------------- |
| [Specification](docs/specification.md)   | Authoritative product specification    |
| [Decisions](docs/decisions.md)           | How the specification is applied       |
| [Development guide](docs/development.md) | Setup, build, test, and debug workflow |
| [Release procedure](docs/release.md)     | Versioning, packaging, and publishing  |
| [MVP acceptance](docs/acceptance.md)     | Acceptance tests and release gate      |

## Quick start for contributors

Requirements: Node.js 22 or newer, npm, Git, and VS Code 1.110 or newer. If Node.js is not
installed yet, see [Installing Node.js with nvm](docs/development.md#installing-nodejs-with-nvm-linux-macos-wsl).

```bash
npm install
npm run verify   # typecheck, lint, format check, build, unit tests
```

To try the extension, open the repository in VS Code, choose **Run Extension** in **Run and Debug**,
and press `F5`. Details are in the [development guide](docs/development.md).

## Contributing

Contributions are welcome. Please read [CONTRIBUTING.md](CONTRIBUTING.md) and the
[Code of Conduct](CODE_OF_CONDUCT.md). To report a vulnerability, follow [SECURITY.md](SECURITY.md).

## License

Lorequill is licensed under the [Apache License, Version 2.0](LICENSE).

The name Lorequill is a product naming decision, not a claim of trademark clearance or
platform-handle availability.
