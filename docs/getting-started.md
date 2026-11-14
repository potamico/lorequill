# Getting started

## Requirements

- VS Code 1.110 or newer and Git.
- A Git clone of a documentation repository with Markdown pages, for example an MkDocs site.

## 1. Add a profile

Lorequill becomes active in a folder that contains `.lorequill/config.yaml`. A minimal profile for
an MkDocs site with its pages in `docs/`:

```yaml
version: 1
locale: en

content:
  root: docs
  include: ["**/*.md"]

review:
  base_branch: main

checks:
  rules:
    - { id: links, rule: relative-links }
    - { id: no-wikilinks, rule: forbidden-text, text: "[[" }
```

Commit the profile, so that every author and CI use the same one. The
[profile reference](reference/profile.md) lists every option; collections with fields and
templates are described in the [user guide](user-guide.md#properties).

## 2. Open the repository

1. Install Lorequill from the
   [Visual Studio Marketplace](https://marketplace.visualstudio.com/items?itemName=potamico.vscode-lorequill)
   or [Open VSX](https://open-vsx.org/extension/potamico/vscode-lorequill).
2. Open the repository folder in VS Code and trust it when asked. In an untrusted workspace,
   Lorequill reads no files.
3. Open the Lorequill view in the activity bar. **Pages** lists the pages; selecting one opens it
   in the Lorequill editor.

## 3. Check in CI

Add the [checks Action](reference/ci.md) to the repository's workflows, so that pull requests run
the same checks as the editor.

## Next steps

The [user guide](user-guide.md) covers editing, links, drafts, retiring pages, commits, and
submitting for review.
