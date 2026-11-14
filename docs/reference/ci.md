# CI with GitHub Actions

The Lorequill checks Action runs the checks of a repository's `.lorequill/config.yaml` in GitHub
Actions, with the same check engine that the Lorequill extension bundles. It prints its engine
version, annotates findings in the pull request, and can write SARIF for code scanning.

The Action reads files only. It installs nothing, runs no repository scripts, hooks, or Git
commands, and has no network access of its own, so it is safe on pull request checkouts. Its code
is a single committed bundle, `action/dist/index.cjs`; `action/dist/THIRD_PARTY_NOTICES.txt`
lists the bundled dependencies and their licenses.

## Usage

Pin the Action to a full commit SHA of a Lorequill release, never to a branch or a movable tag,
and declare the same engine version in the profile so the editor can show a notice when it runs
a different engine:

```yaml
# .lorequill/config.yaml
checks:
  engine_version: 0.2.0 # the engine version of the pinned Action
```

```yaml
# .github/workflows/lorequill.yml
name: Lorequill checks
on:
  pull_request:
permissions:
  contents: read
jobs:
  checks:
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          persist-credentials: false
      - uses: potamico/lorequill/action@<COMMIT_SHA> # Lorequill vX.Y.Z
```

Replace `<COMMIT_SHA>` with the commit of the release tag, for example from
`git ls-remote https://github.com/potamico/lorequill refs/tags/vX.Y.Z`, and keep the version in the
comment so Dependabot and reviewers can see it.

### Inputs

| Input              | Default | Meaning                                                                       |
| ------------------ | ------- | ----------------------------------------------------------------------------- |
| `path`             | `.`     | Repository directory to check, relative to the workspace.                     |
| `sarif-file`       | (none)  | Also write the findings as SARIF 2.1.0 to this file.                          |
| `fail-on-findings` | `true`  | Fail the step on findings. An incomplete check (timeout, limit) always fails. |

### Outputs

`engine-version`, `status` (`passed`, `failed`, or `error`), `findings` (count), and `sarif-file`
(absolute path, when written).

### Code scanning (SARIF)

```yaml
permissions:
  contents: read
  security-events: write
steps:
  - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
    with:
      persist-credentials: false
  - uses: potamico/lorequill/action@<COMMIT_SHA> # Lorequill vX.Y.Z
    with:
      sarif-file: lorequill.sarif
      fail-on-findings: "false"
  - uses: github/codeql-action/upload-sarif@33d7b85da1a04171e211befe2c739303b9a4c066 # v4.39.3
    if: always()
    with:
      sarif_file: lorequill.sarif
      category: lorequill
```

SARIF paths are relative to the checked repository. When `path` is not the workspace root, pass
the same directory to the upload as `checkout_path`.

SARIF and the workflow log contain finding locations and messages, which can quote page content.
Their visibility follows the repository's visibility on GitHub.

## Exit status

`0` no findings, `1` findings (unless `fail-on-findings` is `false`), `2` profile or execution
error, the same as the [`lorequill-checks` CLI](checks.md#command-line).
