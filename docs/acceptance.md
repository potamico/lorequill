# MVP acceptance

How the acceptance tests of the specification (§16) and the release gate (§17) are covered. Unit
tests run with `npm run test:unit`, extension host tests with `npm run test:integration` (scenario
in brackets), and the GitHub end-to-end test with `npm run test:e2e:github`. CI runs all but the
GitHub end-to-end test on every pull request.

Paths are relative to `packages/`; `u:` is `test/unit/`, `i:` is `test/integration/suite/`.

## MVP acceptance scenario (§17)

`extension/i:git/acceptance.test.ts` runs the scenario in the extension host. An author on a
feature branch opens two pages in the Lorequill editor and edits both bodies. One page also gets a
property change and a relative link with the path that link completion offers. Native save writes
both pages without a commit or branch change. `Check Pages` reports the broken link in the
unsaved buffer, and after the fix it passes. `Commit` commits exactly the two pages with the
commit check on the staged tree, leaving an unrelated unstaged change untouched.
`Submit for Review` pushes to the remote and creates one review with both branch commits.
The committed bytes are exactly the original pages plus the intended edits, and the pinned
Action bundle passes on the result. The remote is a local bare repository, and the review host
is the mock host. `extension/test/e2e/github-submit.test.ts` covers the same submission against
a disposable GitHub repository (AT 41).

## Release gate

| Requirement                               | Evidence                                                                                                                                          |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Apache-2.0 license, distribution metadata | `LICENSE`, `NOTICE`, third-party notices in the VSIX and the Action; `extension/u:manifest.test.ts` (release identity); `scripts/verify-vsix.mjs` |
| Native save semantics                     | `extension/i:editor/page-editor.test.ts` (saves only through native save); `extension/i:checks/diagnostics.test.ts` (never saves)                 |
| Multi-page commits                        | `extension/i:git/commit.test.ts` (two pages together); `extension/i:git/acceptance.test.ts`                                                       |
| Standard-index commit behavior            | `extension/i:git/commit.test.ts` (pre-staged files, unstaging, unstaged changes); `extension/u:git-commit.test.ts`                                |
| Immutable staged-tree check snapshots     | `extension/u:git.test.ts` (index snapshot, no `write-tree`, hooks and filters); `extension/i:git/commit.test.ts` (staged state)                   |
| Safe PR submission                        | `extension/i:git/submit.test.ts`; `extension/u:submit.test.ts`; `extension/test/e2e/github-submit.test.ts`                                        |

## Acceptance tests

| AT  | Covered by                                                                                                                                                                                                                                                                              |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `extension/u:folder-status.test.ts`; `extension/i:trusted/pages-tree.test.ts` (invalid profile); `extension/i:multi-root/multi-root.test.ts`                                                                                                                                            |
| 2   | `profile/u:rejections.test.ts`; `profile/u:hostile-input.test.ts`                                                                                                                                                                                                                       |
| 3   | `markdown/u:update-front-matter.test.ts`; `extension/u:properties.test.ts`; `extension/i:editor/properties.test.ts` (AT 3, 4, 54)                                                                                                                                                       |
| 4   | `markdown/u:update-front-matter.test.ts`; `extension/i:editor/properties.test.ts` (unsafe YAML stays read-only)                                                                                                                                                                         |
| 5   | `extension/u:properties.test.ts`; `extension/i:editor/properties.test.ts` (AT 5)                                                                                                                                                                                                        |
| 6   | `extension/i:editor/page-editor.test.ts` (view modes without edits); `editor/u:formatting.test.ts` (Material constructs untouched); `editor/u:render.test.ts`                                                                                                                           |
| 7   | `extension/i:editor/page-editor.test.ts` (native save only); `extension/i:git/acceptance.test.ts` (save without commit or branch change)                                                                                                                                                |
| 8   | `editor/u:sync.test.ts` (stale edits, random interleavings); `extension/i:editor/page-editor.test.ts` (stale edit rejected); `extension/i:editor/properties.test.ts` (AT 8)                                                                                                             |
| 9   | `extension/i:editor/page-editor.test.ts` (two modified pages); `extension/i:git/acceptance.test.ts`                                                                                                                                                                                     |
| 10  | `extension/i:trusted/pages-tree.test.ts` (excluded pages); `checks/u:relative-links.test.ts` (anchors in excluded pages)                                                                                                                                                                |
| 11  | `extension/u:new-page.test.ts`; `extension/i:editor/links.test.ts` (AT 11, collisions)                                                                                                                                                                                                  |
| 12  | `markdown/u:slug.test.ts`                                                                                                                                                                                                                                                               |
| 13  | `markdown/u:link-target.test.ts` (path building); `editor/u:link-completion.test.ts`; `extension/u:link-items.test.ts`                                                                                                                                                                  |
| 14  | `markdown/u:links.test.ts`; `markdown/u:links-property.test.ts`; `markdown/u:link-target.test.ts`                                                                                                                                                                                       |
| 15  | `markdown/u:link-target.test.ts` (`..` inside, escapes, symlinks); `checks/u:relative-links.test.ts`                                                                                                                                                                                    |
| 16  | `checks/u:relative-links.test.ts` (missing targets, external links)                                                                                                                                                                                                                     |
| 17  | `markdown/u:anchors.test.ts` against `fixtures/anchors/python-markdown.json`; known differences in `markdown/README.md`                                                                                                                                                                 |
| 18  | `checks/u:rules.test.ts`; `checks/u:relative-links.test.ts`                                                                                                                                                                                                                             |
| 19  | `checks/u:engine.test.ts` (listing order); `checks/u:rules.test.ts` (duplicates)                                                                                                                                                                                                        |
| 20  | `server/u:folder-checker.test.ts` (AT 20: language server, CLI, SARIF); `checks/u:cli.test.ts`; `checks/u:action.test.ts`                                                                                                                                                               |
| 21  | `server/u:folder-checker.test.ts` (versions, outdated results); `extension/i:checks/diagnostics.test.ts` (stale findings)                                                                                                                                                               |
| 22  | `checks/u:engine.test.ts` (cancellation, timeout, limits, truncation); `checks/u:budget.test.ts`                                                                                                                                                                                        |
| 23  | `extension/i:editor/page-editor.test.ts`; `extension/i:git/acceptance.test.ts`                                                                                                                                                                                                          |
| 24  | `extension/i:git/commit.test.ts` (two pages together)                                                                                                                                                                                                                                   |
| 25  | `extension/i:git/commit.test.ts` (second commit stays on the branch)                                                                                                                                                                                                                    |
| 26  | `extension/i:git/commit.test.ts` (unstaged edits, pre-staged files); `extension/u:commit-flow.test.ts`; `extension/i:git/acceptance.test.ts`                                                                                                                                            |
| 27  | `extension/u:git-commit.test.ts` (changed index or HEAD, unverified commit); `extension/i:git/commit.test.ts` (hook); `extension/i:git/submit.test.ts` (blocked)                                                                                                                        |
| 28  | `extension/i:git/commit.test.ts` (blocks the commit, never Save)                                                                                                                                                                                                                        |
| 29  | `extension/i:git/submit.test.ts` (several page commits); `extension/test/e2e/github-submit.test.ts`                                                                                                                                                                                     |
| 30  | `extension/i:git/submit.test.ts` (base branch, detached HEAD); `extension/u:submit.test.ts`                                                                                                                                                                                             |
| 31  | `extension/i:git/submit.test.ts` (failed review creation, retry); `extension/u:submit.test.ts`                                                                                                                                                                                          |
| 32  | `extension/i:git/submit.test.ts` (diverged remote, no force push); `extension/i:git/git.test.ts` (checkout outside VS Code); `extension/u:git-commit.test.ts`                                                                                                                           |
| 33  | `extension/u:submit.test.ts` (plan with destination and all branch commits)                                                                                                                                                                                                             |
| 34  | `extension/u:git-commit.test.ts` (author identity); `extension/i:git/commit.test.ts` (message and author)                                                                                                                                                                               |
| 35  | `extension/i:git/commit.test.ts`, `extension/i:git/git.test.ts` (staged deletion)                                                                                                                                                                                                       |
| 36  | `extension/i:untrusted/untrusted.test.ts`                                                                                                                                                                                                                                               |
| 37  | `markdown/u:link-target.test.ts`, `profile/u:load.test.ts` (symlink escapes); `editor/u:sync.test.ts`, `editor/u:properties-protocol.test.ts`, `extension/i:editor/page-editor.test.ts` (hostile messages, links outside the root); `extension/i:editor/links.test.ts` (`../escape.md`) |
| 38  | `extension/u:logger.test.ts` (closed vocabulary; see the logging audit below)                                                                                                                                                                                                           |
| 39  | `extension/i:multi-root/multi-root.test.ts`; `extension/i:git/git.test.ts` (folders kept apart)                                                                                                                                                                                         |
| 40  | `checks/u:action.test.ts` (AT 40)                                                                                                                                                                                                                                                       |
| 41  | `extension/test/e2e/github-submit.test.ts` (opt-in); the GitLab part is not covered, GitLab is not supported yet                                                                                                                                                                        |
| 42  | `extension/i:checks/diagnostics.test.ts` (unsaved buffers); `extension/i:git/commit.test.ts` (staged state); `extension/u:i18n.test.ts` (AT 42 labels)                                                                                                                                  |
| 43  | `extension/i:git/commit.test.ts`; `extension/u:commit-flow.test.ts`                                                                                                                                                                                                                     |
| 44  | `extension/u:properties.test.ts` (missing required fields); `extension/u:git-commit.test.ts` (AT 44)                                                                                                                                                                                    |
| 45  | `extension/i:editor/page-editor.test.ts` (AT 45: webview reload, external change, stale edits, flush before save); `extension/i:editor/properties.test.ts` (AT 8)                                                                                                                       |
| 46  | `extension/i:git/submit.test.ts` (merged review); `extension/u:submit.test.ts`; `extension/test/e2e/github-submit.test.ts`                                                                                                                                                              |
| 47  | `extension/i:git/commit.test.ts` (staged deletion); no special configuration exists                                                                                                                                                                                                     |
| 48  | `markdown/u:links.test.ts`; `markdown/u:links-property.test.ts`                                                                                                                                                                                                                         |
| 49  | `checks/u:budget.test.ts` (1,000 pages and 1 MiB); `checks/u:engine.test.ts` (reuse of parsed pages); `extension/u:scan.test.ts` (cache)                                                                                                                                                |
| 50  | `extension/u:git-commit.test.ts`; `extension/i:git/commit.test.ts`, `extension/i:git/submit.test.ts` (hook leaves the commit unverified)                                                                                                                                                |
| 51  | `extension/i:editor/page-editor.test.ts` (view modes without edits)                                                                                                                                                                                                                     |
| 52  | `editor/u:sync.test.ts`; `editor/u:formatting.test.ts`; `extension/i:editor/page-editor.test.ts` (CRLF, undoable edits)                                                                                                                                                                 |
| 53  | `editor/u:formatting.test.ts` (single-character task toggle)                                                                                                                                                                                                                            |
| 54  | `extension/i:editor/page-editor.test.ts` (undo through VS Code); `extension/i:editor/properties.test.ts` (AT 54)                                                                                                                                                                        |
| 55  | `editor/u:render.test.ts` (raw HTML, images, link destinations)                                                                                                                                                                                                                         |
| 56  | `editor/u:scroll-sync.test.ts`                                                                                                                                                                                                                                                          |
| 57  | `editor/u:editing-commands.test.ts` (AT 57)                                                                                                                                                                                                                                             |
| 58  | `editor/u:editing-commands.test.ts` (AT 58); `editor/u:formatting.test.ts`                                                                                                                                                                                                              |
| 59  | `extension/i:editor/links.test.ts` (AT 59, text editor); `editor/u:link-completion.test.ts` (matching); `extension/u:link-items.test.ts` (code)                                                                                                                                         |
| 60  | `extension/u:manifest.test.ts` (keybindings, AT 60)                                                                                                                                                                                                                                     |
| 61  | `markdown/u:links.test.ts` (containers); `checks/u:relative-links.test.ts` (links in Material containers); `editor/u:admonition-syntax.test.ts`                                                                                                                                         |
| 62  | `extension/i:multi-root/multi-root.test.ts` (display language); `extension/i:editor/page-editor.test.ts` (toolbar labels); `extension/u:i18n.test.ts`                                                                                                                                   |
| 63  | `extension/i:editor/page-editor.test.ts` (option, not default; switching editors); `extension/i:trusted/pages-tree.test.ts` (opens in the Lorequill editor)                                                                                                                             |

## Security review

- **Symlink escapes.** The profile loader rejects a profile or `.lorequill` directory that resolves
  outside the workspace. The link resolver and the check snapshot verify real paths and exact
  case. The shared content walk never follows symbolic links. Staged-tree snapshots treat symlinks
  and submodules as unsupported, and page creation accepts only a single file name.
- **Webview messages.** Every message from the page editor and the Properties view is validated
  against a closed schema (`editor/src/protocol.ts`, `properties-protocol.ts`). Unknown,
  malformed, oversized, or extra-field messages are ignored. Edits carry a base version, and stale
  ones are rejected. Links are resolved by the host inside the content root, and external schemes
  go through VS Code's link protection.
- **Logging audit.** The logger accepts only numbers, booleans, and a closed set of codes as field
  values (`extension/src/core/logger.ts`). Folders are logged by index, never by name or path.
  The only other log line is a fixed warning in the webview console. Git and hook output is shown
  to the author but never logged, and tokens are never logged or stored.
- **CI.** The Action reads files only, guards its log against workflow commands from page text,
  and passes on a repository with hostile scripts and hooks without running them (AT 40).

The privacy notice is [`privacy.md`](privacy.md).
