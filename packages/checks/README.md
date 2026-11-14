# @lorequill/checks

The Lorequill check engine and CLI (specification §11 and §14). The same engine runs in the editor
(through the language server), on the command line, and in CI. It reads an immutable snapshot of
the content root, never writes, and never executes repository code.

This package has no dependency on VS Code. It is an internal workspace package (`private`)
consumed as TypeScript source; the CLI is bundled into `dist/cli.cjs` by `npm run build`.

## CLI

```bash
node packages/checks/dist/cli.cjs [--format text|json|sarif] [--output FILE] [REPOSITORY]
```

The repository defaults to the current directory and must contain `.lorequill/config.yaml`.

| Exit code | Meaning                                                                    |
| --------- | -------------------------------------------------------------------------- |
| `0`       | Complete run, no findings                                                  |
| `1`       | Complete run with findings                                                 |
| `2`       | Invalid profile or arguments, or an incomplete run (timeout, limit, error) |

Text output has one line per finding (`path:line:column: error <check id>: <message> [<code>]`)
and a summary with the engine version and snapshot identifier. `--format sarif` writes SARIF 2.1.0
for code scanning; `--format json` writes the complete result.

## API

```ts
import { createFileSystemSnapshot, runChecks, withOverrides } from "@lorequill/checks";

const snapshot = createFileSystemSnapshot("/repo/docs");
const result = await runChecks({ profile, snapshot, signal });
// { status: "passed" | "failed" | "error", findings, error?, engineVersion, snapshotId, pagesChecked }

// Unsaved editor buffers on top of the files on disk:
await runChecks({ profile, snapshot: withOverrides(snapshot, new Map([["a.md", text]])) });
```

A finding has the check `id` from the profile, the rule name, a stable `code`, `params`, an English
`message`, a repository-relative POSIX `path`, a 1-based `line`, and an optional `column`. Every
finding is an error in profile version 1.

## Guarantees

- **Determinism.** Files are processed in sorted path order (code-unit order, independent of the
  machine's locale), and findings are sorted by path, line, column, check id, and code. Identical
  file bytes, profile, and engine version give identical findings and byte-identical reports.
- **Snapshot identifier.** A SHA-256 over the listed file paths and the content of every text the
  run read (pages and anchor targets).
- **Incomplete is never a pass.** Cancellation, the run-level `checks.timeout_seconds` (default
  30), a listing above 50,000 entries, a page above 4 Mi UTF-16 code units, more than 10,000
  findings, or an unreadable page end the run with `status: "error"` and the findings found so
  far. The CLI exits `2`.
- **Budget.** `test/unit/budget.test.ts` checks 1,000 pages plus a 1 MiB page; the run must finish
  within 30 seconds (about 4 seconds on a development machine) on the CI runners (decision D7).

## Rules

| Rule              | Behavior                                                                                                                                                                                                                                                                                                                                                                                    |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `relative-links`  | Every link of an included page is external (`http:`, `https:`, `mailto:`, never fetched) or a relative path to a regular file inside the content root. Defaults: `anchors: true`, `slugify: ascii` (D11). Fragments are checked only for Markdown targets; excluded pages are valid targets.                                                                                                |
| `forbidden-text`  | Literal, case-sensitive substring; one finding per matching line, at the first occurrence. The whole file is checked, including front matter.                                                                                                                                                                                                                                               |
| `allow-values`    | On each line containing `marker`, the trimmed text after its first occurrence, without one surrounding backtick pair, must be one of `values` (literal, case-sensitive). The whole file is checked.                                                                                                                                                                                         |
| `unique-field`    | Non-empty scalar values of a front matter field must be unique after normalization (D10: NFC, trimmed, whitespace collapsed, lower case). Duplicates are reported on later pages in path order and name the first page. Lists and mappings are reported as not scalar.                                                                                                                      |
| `reference-field` | On pages in scope (all, or those whose `when.field` is in `when.in`), each value of `field` (a single value or a list) must equal the `target` field of another included page, compared like `unique-field`. With `required: true`, a missing or empty field is reported (`reference-field/missing`); otherwise pages without it are skipped. Other codes: `unknown`, `self`, `not-scalar`. |
| `field-format`    | On pages in scope (all, or those whose `when.field` is in `when.in`), the field must be a string `<PREFIX>-<digits>` with one of the `prefixes` (case-sensitive). A missing field is reported on line 1.                                                                                                                                                                                    |

Front matter that cannot be read safely produces one `front-matter/invalid` finding per page and
field rule, because the rule cannot decide.

## Tests

Unit tests in `test/unit` use in-memory snapshots. `cli.test.ts` bundles the CLI with esbuild and
runs it as a child process against temporary repositories.
