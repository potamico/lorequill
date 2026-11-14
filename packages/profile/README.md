# @lorequill/profile

Closed JSON Schema, generated TypeScript types, validator, and loader for the Lorequill repository
profile (`.lorequill/config.yaml`, profile version 1). Specification: sections 6, 9, 11, and 15.

This package has no dependency on VS Code. It is used by the extension, the language server, and
the check CLI. It is currently an internal workspace package (`private`) consumed as TypeScript
source.

## API

```ts
import { loadProfile, parseProfile } from "@lorequill/profile";

// From text (for example the content of an open editor):
const result = parseProfile(yamlText);

// From a workspace folder; reads <root>/.lorequill/config.yaml safely:
const loaded = await loadProfile(workspaceRoot);

if (result.ok) {
  result.profile; // typed `Profile`
} else {
  result.issues; // [{ code, path, line?, column?, params? }]
}
```

Issues carry a stable `code` (also the English message key for translation catalogs), a JSON
Pointer `path`, an optional 1-based `line` and `column`, and `params` for message placeholders. The
package never produces localized text. Rejected scalar values are not copied into issues, with the
exception of unknown rule and widget names and the unsupported version number.

## What is validated

1. **File access (`loadProfile`).** The real path of the profile must stay inside the real path of
   the workspace folder (symlink escapes are rejected). The file must be a regular UTF-8 file of at
   most 256 KiB.
2. **YAML level.** YAML 1.2 core schema only. Rejected: syntax errors, duplicate keys, multiple
   documents, merge keys, anchors, aliases, and every explicit tag (including `!!js/function`,
   `!!binary`, `!!set`, and `!!timestamp`). Nothing is ever evaluated.
3. **Version.** Any `version` other than `1` yields a single `unsupported-version` issue.
4. **Closed schema.** Unknown keys, unknown rules, unknown widgets, and wrong types are rejected.
   No parameter can carry a command, `argv`, a shell expression, or a regular expression.
5. **Cross references.** Duplicate check IDs, duplicate collection IDs, duplicate field keys within
   a collection, and a `select` default that is not one of its options.

## Schema decisions beyond the specification

The specification names the profile sections and rule parameters but leaves several details open.
These choices are conservative and can be relaxed without breaking valid profiles:

| Area                     | Decision                                                                                                                                                                                                                                                                        |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Required keys            | `version`, `content.root`, and `content.include` are required. `exclude`, `drafts`, `locale`, `review`, `site`, `checks`, and `collections` are optional.                                                                                                                       |
| `checks.engine_version`  | Optional `MAJOR.MINOR.PATCH` version (with optional pre-release) of the check engine that CI runs. The editor shows a notice when its own engine differs.                                                                                                                       |
| `checks.timeout_seconds` | Integer from 1 to 300. The default of 30 is exported as `DEFAULT_CHECK_TIMEOUT_SECONDS` and is not injected into the parsed profile.                                                                                                                                            |
| Rule and collection IDs  | Lowercase letters, digits, `_` and `-`, at most 64 characters.                                                                                                                                                                                                                  |
| Field keys               | Letters, digits, `_` and `-`, not starting with a digit or hyphen, at most 64 characters.                                                                                                                                                                                       |
| `content.root`           | Relative POSIX directory without `..`, drive letters, backslashes, empty segments, or a leading `./`. A single `.` selects the repository root.                                                                                                                                 |
| Globs                    | Relative to the content root; absolute patterns and `..` segments are rejected. Glob semantics are defined by the matcher added in M3.                                                                                                                                          |
| `site`                   | Optional. `url` is an absolute `http`/`https` URL ending with `/`; `stable_links` names a front matter `field` and a `path` with exactly one `{value}`, relative, without `.` or `..` segments. Used for **Copy Stable Link** and by the MkDocs hook in `docs/examples/mkdocs`. |
| `review.base_branch`     | Must be a valid Git branch name and must not start with `-`, so it can never be mistaken for a command-line option.                                                                                                                                                             |
| `{domain}` placeholder   | Supported only as a whole path segment of a collection `folder`.                                                                                                                                                                                                                |
| `field-format.when`      | Shape `{ field, in: [values] }`, derived from the informative example.                                                                                                                                                                                                          |
| Collection `match`       | Shape `{ field, equals }`, derived from the informative example.                                                                                                                                                                                                                |
| Limits                   | Lists and strings are bounded (for example 100 rules, 100 collections, 100 fields per collection, 20,000 characters per template).                                                                                                                                              |
| Defaults of rules        | `relative-links` `anchors` defaults to `true` and `slugify` to `ascii`; `content.exclude` defaults to an empty list (decision D11). Defaults are applied by consumers, not injected into the parsed profile.                                                                    |

## Content scope

`createContentScope(profile.content)` returns `isIncluded(relativePath)`, which decides whether a
file below the content root is a page: it must match an `include` pattern and no `exclude`
pattern. It is the single definition used by the Pages tree and, later, by the check engine.
`isDraft(relativePath)` tells whether a file matches a `content.drafts` pattern: drafts are
checked like other pages but not published, so `relative-links` reports links to them from pages
that are not drafts.

- Patterns are matched with [`picomatch`](https://github.com/micromatch/picomatch) against the
  whole POSIX path relative to the content root. `*.md` selects only files directly in the content
  root; a leading globstar directory selects files at any depth.
- Matching is case-sensitive. Dot files and dot directories match only when the pattern names the
  dot explicitly.
- Negation (`!pattern`) and extended globs (`+(a|b)`) are disabled, because include and exclude
  already express negation and the profile must not offer regular-expression power.
- A directory is not excluded by naming it; exclude its files with a descendant pattern such as
  `drafts/**`.
- A backslash escapes the next character in a pattern; it is never a path separator.

## Generated types

`src/generated/profile.ts` is generated from `schema/profile.schema.json` and is committed.

```bash
npm run generate:types --workspace @lorequill/profile   # regenerate
npm run check:types --workspace @lorequill/profile      # fail if stale
```

A unit test fails when the committed file differs from the generator output.

## Tests

Unit tests live in `test/unit`; shared fixtures live in the repository's `fixtures/profiles`
directory (`valid`, `hostile`). One test file validates the profiles printed in the specification
and in the EA Body of Knowledge example. It reads those documents only to check that the schema
accepts them; product behavior does not depend on the example.
