# Development guide

This guide explains how to set up a development environment for Lorequill, build it, run the
checks, and launch the extension in an Extension Development Host.

## Prerequisites

| Tool    | Version                               | Notes                                                   |
| ------- | ------------------------------------- | ------------------------------------------------------- |
| Node.js | 22 or newer (current LTS recommended) | Required to build, lint, and test                       |
| npm     | Bundled with Node.js                  | Workspaces are used; no other package manager           |
| Git     | Any recent version                    | Needed for the repository and, later, for the extension |
| VS Code | 1.110 or newer                        | Needed to run the Extension Development Host            |

### Installing Node.js with nvm (Linux, macOS, WSL)

[nvm](https://github.com/nvm-sh/nvm) installs Node.js into your home directory and does not need
`sudo`. This is the recommended setup, including on Windows Subsystem for Linux (WSL).

```bash
# 1. Install nvm. Check https://github.com/nvm-sh/nvm for the current version number.
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.8/install.sh | bash

# 2. Reload your shell configuration (or open a new terminal).
source ~/.bashrc

# 3. Install and activate the current Node.js LTS release.
nvm install --lts
nvm alias default 'lts/*'

# 4. Verify the installation.
node -v
npm -v
```

If you use `zsh`, replace `~/.bashrc` with `~/.zshrc`. The repository contains an `.nvmrc` file, so
running `nvm use` inside the checkout selects the LTS release.

Other installation methods (for example the NodeSource packages or the Ubuntu `nodejs` package) also
work as long as `node -v` reports version 22 or newer.

> Tools that start a non-interactive shell (for example some IDE tasks or coding agents) do not load
> `~/.bashrc` automatically. If `node` is not found there, run `source ~/.nvm/nvm.sh` first.

### System libraries for the integration test (Linux and WSL)

The extension-host smoke test downloads and starts a real VS Code (Electron) build. On a minimal
Linux or WSL installation, Electron's shared libraries may be missing. On Ubuntu or Debian:

```bash
sudo apt update
sudo apt install -y libnss3 libnspr4 libasound2t64 libgbm1 libgtk-3-0t64
```

On older Ubuntu or Debian releases the audio package is called `libasound2` and the GTK package
`libgtk-3-0`. WSL with WSLg already provides a display.

To run the integration test without a visible desktop session (for example in CI, over SSH, or
simply so no VS Code windows open), install `xvfb` (`sudo apt install -y xvfb`) and run:

```bash
npm run test:integration:headless
```

This runs `npm run test:integration` inside a virtual X server (`xvfb-run -a`). The plain
`npm run test:integration` still uses the current display.

## First-time setup

```bash
git clone <repository-url> lorequill
cd lorequill
npm install
```

`npm install` installs all workspace dependencies and honors the committed `package-lock.json`.
Dependency versions are pinned exactly (`save-exact=true` in `.npmrc`).

esbuild is the only dependency with an install script. It is explicitly approved through the
`allowScripts` entry in the root `package.json`. After installing, the root `postinstall` script
applies the patches in `patches/` with `patch-package` (see the dependency policy).

## Repository layout

```text
.github/                Workflows and Dependabot configuration
.vscode/                Shared launch and task configuration
action/                 Lorequill checks Action with its committed bundle
docs/                   Specification, decisions, guides, examples
packages/extension/     VS Code extension (manifest, activation, views, Git, tests)
packages/editor/        Page editor webview (CodeMirror), rendered preview, Properties webview
packages/server/        Language server for diagnostics
packages/checks/        Check engine and the lorequill-checks CLI
packages/profile/       Profile JSON Schema, generated types, validator, loader, content scope
packages/markdown/      Front matter, titles, slugs, links, anchors (no VS Code dependency)
samples/                Demo and findings workspaces for manual tests
fixtures/               Shared test fixtures (profiles, Markdown, anchors)
scripts/                Release helpers (VSIX verification, third-party notices)
patches/                Fixes to dependencies, applied by patch-package after npm install
```

Inside `packages/extension/src`, the folder `core/` holds logic that does not import `vscode`
(message catalogs, folder states, page scanning, tree model, logger) and is unit-tested with
Vitest; ESLint enforces that rule. Its subfolders are features (`git/`, `host/`, `pages/`,
`properties/`, `links/`, `i18n/`). The VS Code adapters lie next to `core/` in folders per feature
(`folders/`, `pages/`, `editor/`, `properties/`, `checks/`, `git/`, `review/`); `extension.ts` is
the composition root that wires them together, and `test-api.ts` is the internal API for the
integration tests.

## Everyday commands

Run these from the repository root.

| Command                    | Purpose                                                                    |
| -------------------------- | -------------------------------------------------------------------------- |
| `npm run build`            | Bundle the extension, the CLI, and the Action (`action/dist`) with esbuild |
| `npm run typecheck`        | Type-check all sources and tests (strict mode)                             |
| `npm run lint`             | Run ESLint (type-aware rules)                                              |
| `npm run format:check`     | Check formatting with Prettier                                             |
| `npm run format`           | Apply Prettier formatting                                                  |
| `npm run test:unit`        | Run Vitest unit and fixture tests                                          |
| `npm run test:integration` | Build, then run VS Code extension-host tests with `@vscode/test-electron`  |
| `npm test`                 | Run unit tests, then integration tests                                     |
| `npm run verify`           | Typecheck, lint, format check, build, and unit tests (no VS Code needed)   |
| `npm run package`          | Build and verify the VSIX in `dist/` (see [`release.md`](release.md))      |

`npm run verify` is the quick pre-commit check and does not need a VS Code download. The integration
test downloads a stable VS Code build into `packages/extension/.vscode-test/` on first use (about
350 MB); this directory is ignored by Git.

## Running the extension in an Extension Development Host

1. Open the repository root folder in VS Code (or Cursor).
2. Run `npm install` once.
3. Open **Run and Debug**, choose **Run Extension**, and press `F5`.
   The `build-extension` task runs first and bundles the extension.
4. The Extension Development Host opens the demo workspace `samples/demo`. Trust it when asked;
   the Lorequill icon then appears in the activity bar and shows the demo pages under **Pages**.
   The page in `docs/archive/` is excluded by the demo profile and does not appear.
5. To confirm that the extension loaded, run **Lorequill: Show Version** from the Command Palette.

### Samples for manual tests

- `samples/demo` is a showcase that passes every check. Its start page `docs/index.md` lists one
  page per topic: CommonMark with every highlighted code language, GFM, Material for MkDocs,
  links and anchors, pages whose title and aliases differ from the file name, both collections
  with every field widget, a long page, a CRLF page, and Unicode text. CI runs the Checks Action
  on it and expects no findings.
- `samples/findings` has deliberate findings: one page per rule, and every finding code that a
  checkout can produce. Use it for the Problems view, **Check Pages**, and the commit check.
- **Run Extension (both samples)** opens `samples/lorequill.code-workspace` with both folders, which
  also exercises multi-root behavior.

Tests keep the samples complete: `packages/checks/test/unit/samples.test.ts` pins the findings of
`samples/findings` and requires every rule and field widget in the demo profile;
`packages/editor/test/unit/samples.test.ts` renders every demo page and requires a code block for
every highlighted language. Add new syntax, rules, or widgets to the samples first.

To rebuild automatically while developing, run `npm run build:watch --workspace vscode-lorequill` in a
terminal, then use **Developer: Reload Window** in the Extension Development Host after changes.

The extension activates when the opened folder contains `.lorequill/config.yaml`, or when one of its
commands is invoked.

## Language server

The extension bundles the language server (`packages/server`) into `dist/server.js` and starts it
in a separate Node process, only in trusted workspaces. When the extension runs under the
debugger, the server listens for an inspector on port 6011, so a second **Attach to Node Process**
debug session can step through it. Diagnostics appear after a short pause in typing and on save;
**Lorequill: Check Pages** runs a complete check on demand.

## Running the checks from the command line

`npm run build` also bundles the check CLI. Run it against any repository with a profile, for
example the demo workspace:

```bash
node packages/checks/dist/cli.cjs samples/demo
node packages/checks/dist/cli.cjs --format sarif --output report.sarif samples/demo
```

Exit code `0` means no findings, `1` findings, and `2` an invalid profile or an incomplete run. See
`packages/checks/README.md`.

## Generated files

The profile types in `packages/profile/src/generated/profile.ts` are generated from the JSON Schema
and committed. After changing `packages/profile/schema/profile.schema.json`, run:

```bash
npm run generate:types --workspace @lorequill/profile
```

`npm run test:unit` fails when the committed file is stale.

## Testing layout

- **Unit and fixture tests:** Vitest, in `packages/<name>/test/unit/`. These must not import `vscode`.
- **Integration tests:** Mocha inside the VS Code extension host, in
  `packages/extension/test/integration/`. They are compiled to `packages/extension/out/` by
  `tsc -p tsconfig.test.json` and started by `test/integration/runTest.ts`.
  They use the current stable VS Code unless `LOREQUILL_VSCODE_VERSION` names another, for example
  `LOREQUILL_VSCODE_VERSION=1.110.0 npm run test:integration` for the minimum of `engines.vscode`.
  The tests are grouped in scenarios (`suite/trusted`, `suite/untrusted`, `suite/multi-root`).
  The runner creates neutral example workspaces under `packages/extension/.vscode-test/workspaces/`
  and starts one VS Code instance per scenario, each with a fresh user data directory, because the
  workspace and its trust state are fixed at startup. `@vscode/test-electron` always passes
  `--disable-workspace-trust`, so the `untrusted` scenario starts VS Code directly with the same
  arguments except that flag. The `git` scenario uses real repositories, including a local bare
  repository as the remote, and replaces the GitHub host with the mock host
  (`src/core/host/mock-host.ts`).
  Tests reach the extension through its internal API (`src/test-api.ts`), which `activate`
  returns only in VS Code's test mode. Dialogs are injected as prompt interfaces
  (`CommitPrompts`, `SubmitPrompts`, `NewPagePrompts`); the internal API replaces them with
  scripted answers, so production code paths carry no test parameters.
- **End-to-end test against GitHub (acceptance test 41):** `packages/extension/test/e2e/`, run by
  `npm run test:e2e:github`. It is skipped unless `LOREQUILL_E2E_GITHUB_REPO` (`owner/repo` of a
  disposable repository you can push to) and `LOREQUILL_E2E_GITHUB_TOKEN` (a token with
  contents and pull request write access) are set. It pushes a temporary branch, creates and
  reuses a pull request, closes it, checks that it is not reopened, and deletes the branch. The
  token reaches Git only through environment configuration and is never printed.
  The repository needs at least one commit on its default branch. Behind an HTTP proxy, also set
  `NODE_USE_ENV_PROXY=1` (Node 24 or later), so that Node's `fetch` uses `HTTPS_PROXY` as Git
  does.

## Documentation site

The documentation in `docs/` is published at <https://lorequill.potamico.org/> with MkDocs and
Material for MkDocs (`mkdocs.yml`). The developer documents (specification, decisions, this guide,
release procedure, acceptance) stay in the repository and are excluded from the site. Lorequill
checks `docs/` with the root profile `.lorequill/config.yaml`, in the editor and in CI.

To preview the site locally:

```bash
python3 -m venv .venv
.venv/bin/pip install -r docs/requirements.txt
.venv/bin/mkdocs serve
```

`mkdocs build --strict` fails on broken links, missing anchors, and pages missing from the
navigation, as CI does. A new page needs an entry in `nav` of `mkdocs.yml`, or an entry in
`exclude_docs` if it is a developer document.

Material for MkDocs reaches its end of life in May 2027 (decision D35). Until the move, CI also
builds the site with its successor Zensical, which reads the same `mkdocs.yml`. That job is not part
of **`CI passed`**; its built site is kept as the artifact `site-zensical` for seven days. To build
it locally:

```bash
.venv/bin/pip install -r docs/requirements-zensical.txt
.venv/bin/zensical serve
```

## Continuous integration and repository security

Workflows live in `.github/workflows/`. They only use GitHub-provided services and no secrets.

| Workflow                | Runs on                                | Purpose                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ----------------------- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `ci.yml`                | push to `main`, pull requests          | `Verify` (`npm run verify`) on Linux, Windows, macOS with the current Node.js LTS and on Linux with Node.js 22; `Extension host tests` on all three systems with the current VS Code and on Linux with the minimum version 1.110.0; `Checks Action` on the demo and on `docs/`; `Documentation site` (`mkdocs build --strict`); `Package VSIX`; `Audit runtime dependencies`; aggregate job **`CI passed`**; `Documentation site (Zensical preview)` outside of it |
| `docs.yml`              | push to `main` (documentation), manual | Builds the documentation site and deploys it to GitHub Pages                                                                                                                                                                                                                                                                                                                                                                                                       |
| `codeql.yml`            | push to `main`, pull requests, weekly  | CodeQL code scanning for JavaScript/TypeScript and for the workflow files                                                                                                                                                                                                                                                                                                                                                                                          |
| `dependency-review.yml` | pull requests                          | Fails when a pull request adds a runtime dependency with a known vulnerability (moderate or higher) or with a GPL, AGPL, or SSPL license                                                                                                                                                                                                                                                                                                                           |
| `dependabot.yml`        | weekly (Monday)                        | Grouped update pull requests for npm packages, GitHub Actions, and the Python packages of the documentation, with a seven-day cooldown for new releases                                                                                                                                                                                                                                                                                                            |

`.gitattributes` forces LF line endings so Prettier and the byte-exact fixtures behave the same on
Windows runners.

### Settings to enable on GitHub (not controlled by files in the repository)

- **Branch protection (or a ruleset) for `main`:** require pull requests and the status check
  **`CI passed`**. Require this single job instead of every matrix entry; it fails when any
  `Verify`, `Extension host tests`, or `Audit runtime dependencies` job fails.
- **Code security:** enable the dependency graph, Dependabot alerts and security updates, and
  secret scanning with push protection. Keep the _default_ CodeQL setup switched off; the repository
  uses the advanced setup in `codeql.yml`, and both together are rejected by GitHub.
- **Visibility:** the repository is public, which makes CodeQL, dependency review, and secret
  scanning free. A private fork needs GitHub Advanced Security for them, or the jobs in
  `codeql.yml` and `dependency-review.yml` fail.
- **Actions permissions:** allow actions and reusable workflows from GitHub only (the workflows use
  `actions/*`, `github/codeql-action`) and set the default `GITHUB_TOKEN` permission to read-only.
- **Pages:** source "GitHub Actions", custom domain `lorequill.potamico.org` with HTTPS enforced,
  and the domain verified for the account or organization. The DNS of `potamico.org` has a
  `CNAME` record `lorequill` pointing to `potamico.github.io`.

### Updating pinned actions

Actions are pinned to full commit SHAs with the version in a trailing comment. Dependabot opens the
update pull requests. To update by hand, resolve the _commit_ of the tag, not the tag object:

```bash
git ls-remote https://github.com/actions/checkout 'refs/tags/v7*'
# For annotated tags, use the line ending in ^{}, which is the peeled commit.
```

### Known limits

- The workflows cannot be run locally. Validate changes with
  [`actionlint`](https://github.com/rhysd/actionlint); `.github/dependabot.yml` validates against
  the schema at <https://json.schemastore.org/dependabot-2.0.json>.
- Some tests (for example symbolic-link handling) behave differently on Windows because creating
  symbolic links needs a privilege there. Fix platform-specific failures in the test or the code;
  do not remove the platform from the matrix.
- Dependabot ignores `@types/vscode` (it must match `engines.vscode` and is raised by hand), major
  versions of `@types/node` (the minimum supported Node.js is 22), and TypeScript 6.1 or later
  (see the dependency policy). Remove these rules when the reason no longer applies.

## Dependency policy

- Pin exact versions and commit `package-lock.json`.
- Check that every new dependency's license is compatible with Apache-2.0.
- `npm audit --omit=dev` must report no vulnerabilities in runtime dependencies. Advisories that
  only affect development tooling (for example transitive `minimatch` versions pulled in by ESLint
  or Mocha) are tracked and resolved through upstream updates; do not use `npm audit fix --force`
  because it can downgrade tooling.
- Patches to dependencies live in `patches/` and are applied by `patch-package --error-on-fail`
  in the root `postinstall` script, so `npm install` and `npm ci` fail loudly if a patch no longer
  applies. Each patch needs a test that fails without it and an upstream report. When Dependabot
  updates a patched package, check whether the release contains the fix: if so, delete the patch;
  if not, recreate it for the new version (`npx patch-package <package>` after editing the file in
  `node_modules`).
  - `micromark+4.0.3.patch`: micromark rebuilt the whole event list whenever a quote or list
    closed, which is quadratic in their number (a 1 MiB page of quotes took over 100 seconds). The
    patch only changes the end of the list and yields identical syntax trees. Guarded by
    `packages/editor/test/unit/budget.test.ts`.
- TypeScript is pinned to the 6.0 line because `typescript-eslint` does not yet support
  TypeScript 7. Revisit this when `typescript-eslint` adds support.

## Troubleshooting

- **`node: command not found`:** Load nvm (`source ~/.nvm/nvm.sh`) or open a new terminal.
- **`error while loading shared libraries: libnspr4.so` during `test:integration`:** Install the
  system libraries listed above.
- **Integration test cannot open a display:** Install `xvfb` and run through `xvfb-run -a`.
- **`bad option: --disable-extensions` (or other VS Code options):** The shell inherited
  `ELECTRON_RUN_AS_NODE` from a VS Code or Cursor terminal. `runTest.ts` removes this variable and
  all `VSCODE_*` variables before starting the test instance, so this should not occur with the
  provided script. If you launch the downloaded VS Code manually, unset them first.
- **`SIGTRAP`, or errors about `/dev/shm`, `~/.vscode`, or Fontconfig caches:** The test process
  runs in a restricted sandbox (for example some containers or coding-agent sandboxes). Chromium
  needs a writable `/dev/shm` and home directory. Run the integration test outside the sandbox.
- **Log noise from `native-keymap` or D-Bus:** Messages about keyboard layout, D-Bus, or
  Fontconfig on WSL and headless machines are harmless as long as the tests report as passing.
- **Stale test download:** Delete `packages/extension/.vscode-test/` and rerun the test.
