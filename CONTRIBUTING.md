# Contributing to Lorequill

Thank you for your interest in Lorequill. This document explains how to contribute.

By participating, you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md).

## License of contributions

Lorequill is licensed under the [Apache License, Version 2.0](LICENSE). By submitting a
contribution, you agree that it is submitted under Apache-2.0, subject to any applicable
third-party rights. No contributor license agreement is required.

Do not submit code or content that you do not have the right to license under Apache-2.0. If your
change adds a third-party dependency or copies third-party material, state its license in the pull
request so that required notices can be preserved.

## Before you start

- Read the [specification](docs/specification.md). It is the authoritative description of the
  product. Changes to the specification require explicit maintainer approval and should be
  discussed in an issue first.
- The [decisions](docs/decisions.md) record how the specification is applied. Please open an
  issue before starting large work so that it can be coordinated.
- The [EA Body of Knowledge example](docs/examples/ea-body-of-knowledge.md) is informative only.
  Product code, tests, and documentation must not depend on its paths, fields, or values.

## Development setup

Follow the [development guide](docs/development.md). In short:

```bash
npm install
npm run verify
```

## Conventions

- Write everything in English: source code, comments, configuration, documentation, issues, pull
  requests, and commit messages.
- TypeScript runs in strict mode. Keep modules small and avoid abstractions without a concrete
  second use.
- Pin exact dependency versions, commit `package-lock.json`, and justify new dependencies.
- Format with Prettier and lint with ESLint. `npm run verify` must pass.
- Add or update automated tests for every behavior change. Unit and fixture tests use Vitest;
  tests that need VS Code use `@vscode/test-electron`.
- Do not add telemetry, hidden network calls, or logging of page content or credentials.
- Follow the safety invariants in the specification: native save semantics, no implicit Git
  operations, path containment, and data-only profiles.

## Commit messages

Use short, imperative English subjects. The
[Conventional Commits](https://www.conventionalcommits.org/) style is preferred:

```text
feat(markdown): resolve reference-style links
fix(extension): keep activation idempotent
docs: clarify development setup
```

## Pull requests

1. Fork the repository and create a topic branch from `main`.
2. Keep each pull request focused on one concern.
3. Run `npm run verify`, and `npm run test:integration` if you changed extension behavior.
4. Describe what changed and why, link the related issue, and list the
   specification sections involved.
5. Be ready to iterate on review feedback.

## Reporting bugs and requesting features

Open an issue with clear reproduction steps, the expected and actual behavior, your VS Code, Node.js,
and operating system versions, and a minimal sample repository or Markdown snippet if possible. Do
not include confidential content. For security problems, do not open a public issue; follow
[SECURITY.md](SECURITY.md).
