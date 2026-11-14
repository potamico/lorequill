# Lorequill

**Structured Knowledge Documentation for Visual Studio Code.**

Lorequill lets authors browse, edit, validate, commit, and submit Markdown documentation from a
trusted local Git clone, without leaving VS Code. The repository stays the only source of truth.
A declarative repository profile defines page collections and checks, and the same check engine
runs locally and in CI.

> **Status: pre-release.** The MVP features are implemented: Pages tree, page editor with live
> preview, Properties view, page creation and links, checks in the editor and in CI, Commit with
> its automatic check, and Submit for review on GitHub. There is no published release yet; see
> the [changelog](CHANGELOG.md) and the [release procedure](docs/release.md).

## Capabilities

- Pages tree for the Markdown files of a repository.
- CodeMirror-based custom text editor with source mode and basic live-preview decorations.
- Properties panel for safe, semantics-preserving front-matter edits.
- Page creation, relative Markdown link insertion, and link validation.
- A shared check engine with five declarative built-in rules, a CLI, and CI integration.
- Explicit **Check**, **Commit**, and **Submit for review** actions on the current Git branch,
  with GitHub review support first.

Lorequill is a VS Code extension, language server, and reusable check engine. It is not a web
application, wiki, graph database, or site generator. Principles such as native save semantics, no
telemetry, and safe declarative profiles are described in the specification.

## Documentation

| Document                                                              | Purpose                                |
| --------------------------------------------------------------------- | -------------------------------------- |
| [User guide](docs/user-guide.md)                                      | Using Lorequill as an author           |
| [Specification](docs/specification.md)                                | Authoritative product specification    |
| [Decisions](docs/decisions.md)                                        | How the specification is applied       |
| [Development guide](docs/development.md)                              | Setup, build, test, and debug workflow |
| [Commit, submit, and Git hooks](docs/git-workflow.md)                 | How Commit, Submit, and hooks interact |
| [Checks Action](action/README.md)                                     | Running the checks in GitHub Actions   |
| [Release procedure](docs/release.md)                                  | Versioning, packaging, and publishing  |
| [MVP acceptance](docs/acceptance.md)                                  | Acceptance tests and release gate      |
| [Privacy notice](docs/privacy.md)                                     | What Lorequill stores, logs, and sends |
| [EA Body of Knowledge example](docs/examples/ea-body-of-knowledge.md) | Informative example profile only       |

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
