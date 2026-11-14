# Profile reference

The repository profile `.lorequill/config.yaml` declares where the pages are, which checks run,
and optionally page collections with their fields. It is maintained by the repository's
maintainers and is data only: it cannot contain commands, scripts, or regular expressions. The
[user guide](../user-guide.md#the-repository-profile) shows a complete example. With the
[YAML extension](https://marketplace.visualstudio.com/items?itemName=redhat.vscode-yaml)
installed, VS Code completes keys and values while you type and marks mistakes.

## What is validated

1. **File access.** The real path of the profile must stay inside the workspace folder; symbolic
   links that lead outside are rejected. The file must be a regular UTF-8 file of at most 256 KiB.
2. **YAML.** YAML 1.2 core schema only. Rejected: syntax errors, duplicate keys, multiple
   documents, merge keys, anchors, aliases, and every explicit tag (including `!!js/function`,
   `!!binary`, `!!set`, and `!!timestamp`). Nothing is ever evaluated.
3. **Version.** Profile version `1`; any other `version` is reported as unsupported.
4. **Closed schema.** Unknown keys, unknown rules, unknown widgets, and wrong types are rejected.
   No parameter can carry a command, a shell expression, or a regular expression.
5. **Cross references.** Duplicate check IDs, duplicate collection IDs, duplicate field keys within
   a collection, and a `select` default that is not one of its options are rejected.

## Keys and limits

| Area                                    | Rule                                                                                                                                                                                                                                                                    |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Required keys                           | `version`, `content.root`, and `content.include` are required. `exclude`, `drafts`, `locale`, `review`, `site`, `checks`, and `collections` are optional.                                                                                                               |
| `locale`                                | The language of content that Lorequill writes into the repository, such as commit messages, for example `en` or `de-CH`. Interface texts follow the VS Code display language instead.                                                                                   |
| `content.root`                          | Relative POSIX directory without `..`, drive letters, backslashes, empty segments, or a leading `./`. A single `.` selects the repository root.                                                                                                                         |
| `content.include` and `content.exclude` | Glob patterns relative to the content root; absolute patterns and `..` segments are rejected. See [Content scope](#content-scope).                                                                                                                                      |
| `content.drafts`                        | Glob patterns of pages that are checked but not published; `relative-links` reports links to them from published pages.                                                                                                                                                 |
| `review.base_branch`                    | A valid Git branch name that does not start with `-`. Without it, the host's default branch is used.                                                                                                                                                                    |
| `site`                                  | `url` is an absolute `http` or `https` URL ending with `/`; `stable_links` names a front matter `field` and a relative `path` with exactly one `{value}` and no `.` or `..` segments. Used by **Copy Stable Link** and the [MkDocs hook](../examples/mkdocs/README.md). |
| `checks.engine_version`                 | Optional `MAJOR.MINOR.PATCH` version (with optional pre-release) of the check engine that CI runs. The editor shows a notice when its own engine differs.                                                                                                               |
| `checks.timeout_seconds`                | Integer from 1 to 300; the default is 30.                                                                                                                                                                                                                               |
| `checks.rules`                          | The [check rules](checks.md#rules), each with an `id`.                                                                                                                                                                                                                  |
| Rule and collection IDs                 | Lowercase letters, digits, `_` and `-`, at most 64 characters.                                                                                                                                                                                                          |
| Field keys                              | Letters, digits, `_` and `-`, not starting with a digit or hyphen, at most 64 characters.                                                                                                                                                                               |
| `when` of a rule                        | `{ field, in: [values] }`: the rule applies to pages whose field has one of the values.                                                                                                                                                                                 |
| Collection `match`                      | `{ field, equals }`: the collection applies to pages whose field has this value.                                                                                                                                                                                        |
| `{domain}` placeholder                  | Supported only as a whole path segment of a collection `folder`.                                                                                                                                                                                                        |
| Field widgets                           | `string`, `text`, `select`, `boolean`, `date`, `list`, and `hidden`.                                                                                                                                                                                                    |
| Limits                                  | Lists and strings are bounded, for example 100 rules, 100 collections, 100 fields per collection, and 20,000 characters per template.                                                                                                                                   |
| Defaults of rules                       | `relative-links` checks anchors by default (`anchors: true`) with `slugify: ascii`; `content.exclude` defaults to an empty list.                                                                                                                                        |

## Content scope

A file below the content root is a page when it matches an `include` pattern and no `exclude`
pattern. The Pages view and the check engine use the same definition.

- Patterns are matched with [`picomatch`](https://github.com/micromatch/picomatch) against the
  whole POSIX path relative to the content root. `*.md` selects only files directly in the content
  root; a leading globstar directory (`**/*.md`) selects files at any depth.
- Matching is case-sensitive. Dot files and dot directories match only when the pattern names the
  dot explicitly.
- Negation (`!pattern`) and extended globs (`+(a|b)`) are disabled, because include and exclude
  already express negation and the profile must not offer regular-expression power.
- A directory is not excluded by naming it; exclude its files with a descendant pattern such as
  `drafts/**`.
- A backslash escapes the next character in a pattern; it is never a path separator.
- `.git` and `node_modules` are always skipped, symbolic links are not followed, and a listing
  stops after 50,000 entries.
