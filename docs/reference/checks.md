# Checks reference

The same check engine runs in the editor, on the command line, and in CI. It reads a snapshot of
the content root, never writes, and never executes repository code. The checks are declared under
`checks.rules` in the [profile](profile.md); every finding is an error.

## Rules

| Rule              | Behavior                                                                                                                                                                                                                                                                                                                                                                                    |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `relative-links`  | Every link of an included page is external (`http:`, `https:`, `mailto:`, never fetched) or a relative path to a regular file inside the content root. Defaults: `anchors: true`, `slugify: ascii`. Fragments are checked only for Markdown targets; excluded pages are valid targets. Links from published pages to drafts are reported.                                                   |
| `forbidden-text`  | Literal, case-sensitive substring; one finding per matching line, at the first occurrence. The whole file is checked, including front matter.                                                                                                                                                                                                                                               |
| `allow-values`    | On each line containing `marker`, the trimmed text after its first occurrence, without one surrounding backtick pair, must be one of `values` (literal, case-sensitive). The whole file is checked.                                                                                                                                                                                         |
| `unique-field`    | Non-empty scalar values of a front matter field must be unique after normalization (Unicode NFC, trimmed, whitespace collapsed, lower case). Duplicates are reported on later pages in path order and name the first page. Lists and mappings are reported as not scalar.                                                                                                                   |
| `reference-field` | On pages in scope (all, or those whose `when.field` is in `when.in`), each value of `field` (a single value or a list) must equal the `target` field of another included page, compared like `unique-field`. With `required: true`, a missing or empty field is reported (`reference-field/missing`); otherwise pages without it are skipped. Other codes: `unknown`, `self`, `not-scalar`. |
| `field-format`    | On pages in scope (all, or those whose `when.field` is in `when.in`), the field must be a string `<PREFIX>-<digits>` with one of the `prefixes` (case-sensitive). A missing field is reported on line 1.                                                                                                                                                                                    |

Front matter that cannot be read safely produces one `front-matter/invalid` finding per page and
field rule, because the rule cannot decide.

### Heading anchors

`slugify: ascii` produces the anchors of MkDocs' default `toc` extension, `slugify: unicode` those
of `pymdownx.slugs` in lower case. A site with a custom `slugify` or other extensions can produce
different anchors; the site build (`mkdocs build --strict`) stays authoritative.

## Guarantees

- **Determinism.** Files are processed in sorted path order, independent of the machine's locale,
  and findings are sorted by path, line, column, check id, and code. Identical file bytes, profile,
  and engine version give identical findings and byte-identical reports.
- **Incomplete is never a pass.** Cancellation, the run-level `checks.timeout_seconds` (default
  30), a listing above 50,000 entries, a page above 4 Mi UTF-16 code units, more than 10,000
  findings, or an unreadable page end the run with status `error` and the findings found so far.
- **Budget.** 1,000 pages plus a 1 MiB page are checked within 30 seconds.

## Command line

The `lorequill-checks` CLI is built with the repository (`npm run build`):

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
for code scanning; `--format json` writes the complete result. In GitHub Actions, use the
[checks Action](ci.md) instead.
