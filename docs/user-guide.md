# User guide

Lorequill turns a Git clone of a Markdown documentation repository into a writing environment in
VS Code. You browse and edit pages, check them, commit them on your branch, and submit the branch
for review as a GitHub pull request. The repository stays the only source of truth: Lorequill only
uses normal files, the normal Git index, and normal commits.

Interface texts follow the VS Code display language (English or German, Swiss spelling). This
guide uses the English names.

## Getting started

1. Install VS Code 1.110 or newer, Git, and the Lorequill extension.
2. Clone the documentation repository and open its folder (or a multi-root workspace) in VS Code.
3. Trust the workspace when VS Code asks. In an untrusted workspace, Lorequill reads no files and
   only explains what it needs.
4. Open the Lorequill view in the activity bar. It shows **Pages**, **Properties**
   , and **Outline**. You can move these views, for example into
   the secondary side bar.

Lorequill becomes active in folders that contain `.lorequill/config.yaml`, the repository profile.
If the profile is missing or invalid, the Pages view says why, and selecting the message opens the
profile at the problem.

## The repository profile

The profile is maintained by the repository's maintainers. It declares where the pages are, which
checks run, and optionally page collections with their fields:

```yaml
version: 1
locale: de-CH # language of content that Lorequill writes, such as commit messages

content:
  root: docs
  include: ["**/*.md"]
  exclude: ["archive/**"] # neither checked nor shown under Pages
  drafts: ["drafts/**"] # checked, but not published

review:
  base_branch: main

site: # optional: the published site, for stable links
  url: https://docs.example.org/
  stable_links: { field: id, path: "id/{value}/" }

checks:
  engine_version: 0.2.0 # the engine that CI runs, optional
  rules:
    - { id: links, rule: relative-links, slugify: unicode }
    - { id: no-wikilinks, rule: forbidden-text, text: "[[" }
```

The built-in rules are `relative-links`, `forbidden-text`, `unique-field`, `allow-values`,
`field-format`, and `reference-field`. Profiles are data only. They cannot contain commands, scripts, or regular
expressions. The schema and every option are described in the
[profile package](../packages/profile/README.md). With the
[YAML extension](https://marketplace.visualstudio.com/items?itemName=redhat.vscode-yaml) installed,
VS Code completes keys and values in `.lorequill/config.yaml` and marks mistakes while you type.

## Pages

The **Pages** view lists the pages of the content root, by title from the front matter, the first
heading, or the file name. **Filter Pages...** narrows the list by title, file name, or alias.
Selecting a page opens it in the Lorequill editor.

**New Page**, the plus action of a folder or directory, creates a page in exactly
that directory. You enter a title and confirm the proposed file name, for example `Metadaten
Schema` becomes `metadata-schema.md`. A matching collection supplies its template and defaults.
Existing files are never overwritten.

To delete, rename, or move a page, use VS Code's Explorer as usual. When you move or rename a page,
an image, or a whole directory below the content root, Lorequill updates the relative links that
point to it and the moved page's own links, and saves the changed pages; pages with unsaved changes
are updated but stay unsaved. The setting `lorequill.links.updateOnMove` turns this off. Moves made
outside VS Code, for example with `git mv`, are not seen; the `relative-links` check reports the
links they break.

### Stable links

A page's URL on the published site changes when the page moves. If the profile defines stable
links, **Copy Stable Link** in the context menu of a page in the Pages
view, or in the command palette for the open page, copies an address that keeps working, for
example `https://docs.example.org/id/BOK-2/`. Use it wherever links come from outside the
documentation, such as tickets, mail, or other sites; inside the documentation, keep using relative
links. The site build turns these addresses into redirects with the MkDocs hook described in
[examples/mkdocs](examples/mkdocs/README.md); it also lists them all at `https://docs.example.org/id/`.

### Drafts

Work on a page that is meant to be published belongs on a branch: it stays off the site until the
pull request is merged, every check applies, and **Submit for review** offers a new branch when
you start on the base branch.

Pages that are parked for longer, such as ideas or half-finished terms, are better kept on the
base branch in a directory of their own, for example `drafts/`, than on long-lived branches,
which drift from the base branch and hide from others which ids are already taken. Declare that
directory as drafts in the profile, and leave it out of the published site with the same pattern.
With MkDocs 1.6 or later:

```yaml
# .lorequill/config.yaml
content:
  root: docs
  include: ["**/*.md"]
  drafts: ["drafts/**"]
```

```yaml
# mkdocs.yml
draft_docs: |
  drafts/
```

Drafts stay pages: Lorequill checks them, so their ids count as taken, and **Pages** marks them as
**Draft**. A link from a published page to a draft would be broken on the site, so
the `relative-links` check reports it; drafts may link to each other and to published pages.
`mkdocs serve` shows drafts, marked as such, and `mkdocs build` leaves them out. Use
`content.exclude` only for files that should not be checked at all, such as an archive, and leave
them out of the site with `exclude_docs`.

### Retiring pages

An id identifies one page for good. The `unique-field` check only sees pages that exist, so a
deleted page frees its id, and a later page could take it. Its stable link would then lead to a
different page, and old links in tickets and mail would silently point at the wrong thing.

So do not delete a page that has an id. Mark it as retired instead, and name its successor if
there is one:

```yaml
---
title: Process map
id: BOK-4
lifecycle: Retired
replaced_by: BOK-2
---
```

Shorten the content to what still helps, such as why the page is retired. The page stays
checked, so its id stays taken; its stable link and the links to it keep working. With the MkDocs
hook from [examples/mkdocs](examples/mkdocs/README.md#retired-pages), retired pages leave the
site's navigation but stay in its search, and get a notice with links to their successors.
`lifecycle` and `replaced_by` are fields of your collection, as in the demo profile. The
`reference-field` check makes the successor required and verifies that it exists:

```yaml
checks:
  rules:
    - id: successors
      rule: reference-field
      when: { field: lifecycle, in: [Retired] }
      field: replaced_by # a single id, or a list when a page was split
      target: id # must be the id of another page
      required: true # leave out to allow retired pages without a successor
```

If the content really has to go, leave a placeholder with the same id in a drafts directory, for
example `removed/` declared in `content.drafts`. It keeps the id taken and makes the
`relative-links` check report every remaining link to it. The stable link then no longer works.

## Editing

The Lorequill editor is a Markdown editor for pages in the content scope. Other Markdown files,
such as a README, keep VS Code's text editor. The editor-title action switches a page between both
editors (**Open in Lorequill Editor** / **Open as Text**).

- **Modes.** **Edit** shows formatted Markdown while you type. **Both**
  shows the same editor beside a rendered preview that scrolls with the text.
  **Preview** shows only the preview. **Source** shows the plain
  Markdown with its front matter, in Edit and in Both.
  Switching never changes the page.
- **Formatting.** The toolbar and the usual shortcuts format the selection: bold, italic, headings,
  lists, tasks, quotes, code, tables, and links. Enter continues a list, Tab and Shift+Tab indent
  list items, and brackets and backticks close automatically.
- **Find and replace** search the whole page. Replace All is one undo step.
- **Save, undo, redo** are VS Code's own. `Ctrl+S`, Auto Save, and hot exit work as for any file.
  Saving never commits, checks, pushes, or switches branches.
- **Links.** **Insert Link** lets you choose a page and optionally a heading,
  and writes a relative `.md` link. While you type a link destination, completion offers pages and,
  after `#`, headings. Type part of the path, the title, or an alias: `](architecture` finds the
  page "Architecture principles" wherever it lies. The same completion works in the text editor.
  There, VS Code's own Markdown path completion may add plain path suggestions; turn it off with
  the setting `markdown.suggest.paths.enabled` if you like. Ctrl+click on a link opens the linked
  page at its heading.

Material for MkDocs syntax (admonitions, collapsible blocks, content tabs, attribute lists,
snippets) is kept exactly as written. The preview approximates it and never runs scripts, shows
raw HTML, or loads remote content.

## Properties

The **Properties** view edits the front matter of the active page. With a matching collection, it
shows that collection's fields with their labels and widgets, and marks missing required fields.
A missing required field is only a hint: it blocks nothing unless a check rule requires the
field. Otherwise all keys are shown. Changes touch only the edited field, keep comments, unknown
fields, and the body, and are undoable like any edit. Front matter that cannot be read safely is
shown read-only.

## Checks

Checks run in the background on saved and unsaved pages, and their findings appear in the
**Problems** view and in the editor. **Check Pages** runs a complete check of
the editing state and reports the result. A check that times out or hits a limit is reported as
incomplete, never as passed.

## Commit

**Commit** is in the Source Control title bar and in the editor toolbar.

1. Choose the files to commit. Files that are already staged are preselected and marked. Clearing a
   file unstages it, and selecting one stages it, always the whole file. Files outside the content
   root are marked as not checked, and including pre-staged ones needs your confirmation.
2. Lorequill runs the **commit check** on exactly the staged state, not on unsaved or unstaged
   changes. Findings block the commit (but never Save). **Show Commit Check Findings** lists them.
3. Edit the proposed message and confirm. Lorequill makes an ordinary `git commit` on the current
   branch with your Git identity, signing, and hooks.

Unstaged changes stay untouched. If a Git hook changes what is committed, the commit is marked
**Commit not verified** in the status bar, and Submit is blocked
until **Check Commit** passes or a later commit is checked. History is never
rewritten. Details are in [Commit, submit, and Git hooks](git-workflow.md).

## Submit for review

**Submit for Review** shows the destination, the base branch, and
every commit of your branch, then pushes the branch and creates a GitHub pull request, or updates
the open one. The first time, VS Code asks you to sign in to GitHub. Lorequill never force-pushes
or rebases. If the remote branch has commits you do not have, it stops and explains. A
merged or closed pull request is never reopened; continue on a new branch. If you are on the base
branch, for example `main`, Lorequill offers to create a branch for your changes, with a suggested
name, and submits from there; your commits and uncommitted changes move along, and your local
base branch returns to the state on GitHub, so it stays clean for the next change. Submitting from a
detached HEAD is not possible. After submitting, the status bar links to the pull request.

## CI

The [Lorequill checks Action](../action/README.md) runs the same check engine in GitHub Actions.
When `checks.engine_version` in the profile differs from the engine of your editor, the Pages
view shows a notice, and **Show Version** lists both versions. Findings can
then differ between editor and CI.

## Known differences from the published site

- **Heading anchors** follow Python-Markdown: `slugify: ascii` like MkDocs' default `toc`, and
  `slugify: unicode` like `pymdownx.slugs` in lower case. A site with a custom `slugify` or other
  extensions can produce different anchors. The site build (`mkdocs build --strict`) stays
  authoritative. Details are in the [Markdown package](../packages/markdown/README.md#heading-anchors).
- **Anchors and file names differ:** with `ascii`, `Identität` is the anchor `identitat` but the
  file name `identitaet.md`.
- **Snippets** (`--8<--`) are not followed, and raw HTML links are not checked as links.
- **The preview** is an approximation: it renders Material containers and tabs as boxes, shows raw
  HTML as text, and loads images only from inside the content root.

## Troubleshooting

- **No pages, or a message in the Pages view:** check the profile, content root, and include
  patterns, then use **Refresh Pages**.
- **Commit is not offered or fails:** Lorequill needs a branch (not a detached HEAD) and no merge
  conflicts. Hook output is shown when a hook rejects a commit.
- **Submit stops:** the message names the reason, for example a diverged remote branch, missing
  push access, or a pull request that was merged.
- **Logs:** the _Lorequill_ output channel shows operational events without page content.

Privacy: see the [privacy notice](privacy.md).
