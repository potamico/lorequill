# Release procedure

A Lorequill release is one version for every package: the extension, the check engine (and with
it the CLI and the GitHub Action), and the libraries they bundle. The engine version that the
extension, the CLI, the Action, and SARIF report is the version of `@lorequill/checks`, so a
single version number tells authors and CI which engine they run (specification §14).

Releases are made from `main` by a maintainer. Nothing is published automatically.

## Publishing accounts

- **Visual Studio Marketplace.** The publisher `potamico` belongs to the Potamico Microsoft
  account. Publishing with `vsce` needs an Azure DevOps personal access token with the
  _Marketplace (Manage)_ scope, or a Microsoft Entra sign-in; the VSIX can also be uploaded on
  <https://marketplace.visualstudio.com/manage>. The extension is `potamico.vscode-lorequill` with
  the display name "Lorequill – Structured Knowledge Documentation".
- **Never delete an extension on the Marketplace.** Its name and display name stay reserved after
  deletion and cannot be used again, not even by the same publisher. To withdraw a version,
  publish a newer one, or unpublish the extension instead of removing it.
- **Open VSX.** VS Code forks such as VSCodium and Cursor install from <https://open-vsx.org>.
  Publishing needs a GitHub sign-in, an Eclipse account with the signed publisher agreement, the
  namespace `potamico` (`npx ovsx create-namespace potamico`), and an Open VSX token. Claim the
  namespace's verification with an issue in `EclipseFdn/open-vsx.org`.
- **Versions are final.** Neither the Marketplace nor Open VSX accepts a version a second time.

## Steps

1. **Choose the version.** Semantic versioning; `0.x` until the MVP acceptance (specification §17).
2. **Bump every package to it**, from a clean `main`:

   ```bash
   npm version <version> --no-git-tag-version --workspaces --include-workspace-root
   ```

   Update the internal dependency versions (`"@lorequill/*": "<version>"`) in the package
   manifests, run `npm install` to refresh `package-lock.json`, and move the entries under
   `[Unreleased]` in `CHANGELOG.md` to a new section for the version, with the release date and
   the compare links. A unit test fails if the packages do not share one version.

3. **Verify and build** on a clean checkout:

   ```bash
   npm ci
   npm run verify
   npm run test:integration   # or test:integration:headless
   npm run package
   ```

   `npm run verify` rebuilds `action/dist/`; commit it with the version bump. `npm run package`
   writes `dist/vscode-lorequill-<version>.vsix` and verifies it: bundles, localized manifest strings,
   `LICENSE.txt` (Apache-2.0), `NOTICE`, and `dist/THIRD_PARTY_NOTICES.txt` are present; sources,
   tests, source maps, and `node_modules` are not; publisher, name, version, and license match.
   It prints a content digest over all entries. Two builds of the same commit have the same
   digest, even though ZIP timestamps differ; CI checks this.

4. **Review third-party licenses.** `dist/THIRD_PARTY_NOTICES.txt` and
   `action/dist/THIRD_PARTY_NOTICES.txt` list every bundled package. Check that each new license
   is compatible with Apache-2.0 (dependency policy in [`development.md`](development.md)); the
   build fails if a bundled package has no license file.

5. **Optionally run the GitHub end-to-end test** (acceptance test 41) against the disposable
   repository, as described in [`development.md`](development.md).

6. **Commit, push, and wait for CI.** The `CI passed` job covers verify, the extension host tests
   on all platforms, the Action on the demo repository with an up-to-date `action/dist/`, the
   reproducible VSIX, and the runtime dependency audit.

7. **Tag the release commit** and push the tag:

   ```bash
   git tag -s v<version> -m "Lorequill <version>"
   git push origin v<version>
   ```

8. **Create the GitHub release** for the tag and attach the VSIX from step 3 (or the `vsix`
   artifact of the CI run for the tagged commit) with its content digest in the notes. Name the
   commit SHA of the tag in the notes, for pinning the Action.

9. **Publish the extension**, when the release is meant for the Marketplace:

   ```bash
   npx vsce publish --packagePath dist/vscode-lorequill-<version>.vsix
   npx ovsx publish dist/vscode-lorequill-<version>.vsix
   ```

   Publish the exact VSIX that was verified, never a rebuilt one.

## Using a release in CI

Target repositories pin the Action to the full commit SHA of the release tag, never to the tag or
a branch, and declare the same engine version in their profile:

```yaml
- uses: potamico/lorequill/action@<COMMIT_SHA> # Lorequill v<version>
```

```yaml
checks:
  engine_version: <version>
```

The SHA comes from `git ls-remote https://github.com/potamico/lorequill refs/tags/v<version>`. The
Pages view in the editor shows a notice when its engine differs from `checks.engine_version`.
Details are in [CI with GitHub Actions](reference/ci.md).

## Security fixes

Security and compatibility updates follow the same steps with a patch version. Announce the
fixed version and, for the Action, the new commit SHA, in the GitHub release and the security
advisory. Reporting is described in [`SECURITY.md`](https://github.com/potamico/lorequill/blob/main/SECURITY.md).
