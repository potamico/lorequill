# Lorequill checks Action

Runs the checks of a repository's `.lorequill/config.yaml` in GitHub Actions, with the same check
engine that the Lorequill extension bundles.

```yaml
- uses: potamico/lorequill/action@<COMMIT_SHA> # Lorequill vX.Y.Z
```

Usage, inputs, outputs, and code scanning are described in
[CI with GitHub Actions](https://lorequill.potamico.org/reference/ci/) (source:
[`docs/reference/ci.md`](../docs/reference/ci.md)).

The Action's code is the committed bundle `dist/index.cjs`, built from
`packages/checks/src/action.ts` by `npm run build`; `dist/THIRD_PARTY_NOTICES.txt` lists the
bundled dependencies and their licenses.
