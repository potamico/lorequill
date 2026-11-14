# Stable links with MkDocs

Relative links between pages are checked by Lorequill and updated when a page moves in VS Code.
Links from outside the documentation (tickets, mail, other sites) cannot be updated, so they should
use an address that does not depend on where a page lies. [`lorequill_stable_links.py`](lorequill_stable_links.py)
is an MkDocs hook that makes such addresses from a front matter field, typically the unique `id`.

## Setup

1. Give every page that should be linkable from outside a unique value in one front matter field,
   and check it with Lorequill:

   ```yaml
   checks:
     rules:
       - { id: unique-ids, rule: unique-field, field: id }
   ```

2. Declare the site and the stable links in `.lorequill/config.yaml`:

   ```yaml
   site:
     url: https://docs.example.org/
     stable_links: { field: id, path: "id/{value}/" }
   ```

   `path` is relative to `url` and contains `{value}` exactly once.

3. Copy the hook into the documentation repository, for example to `hooks/`, and register it in
   `mkdocs.yml` (MkDocs 1.4 or later):

   ```yaml
   hooks:
     - hooks/lorequill_stable_links.py
   ```

   The hook reads `.lorequill/config.yaml` next to `mkdocs.yml`, so field and path are configured
   in one place. It works with the default theme and with Material for MkDocs.

## What the build writes

For a page `terms/value-stream.md` with `id: BOK-2`, the build writes `id/BOK-2/index.html`, a
small page that redirects to `terms/value-stream/` (with `noindex` and a canonical link, so search
engines index the real page). After the page moves, the next build points the same address at the
new location. Values that cannot be one path segment and values used by more than one page are
skipped with a warning in the build log.

The directory before `{value}` gets an index page, here `id/`, that lists every stable link with
the page's title, rendered with the site's theme and in the site's navigation. Values that have no
stable link are listed below the table with the reason. The index needs MkDocs 1.6 or later and a
path with a directory of its own (`id/{value}/`, not `{value}/`); it is left out when a page
`id/index.md` already exists. To leave it out anyway, set `WRITE_INDEX = False` at the top of the
hook. Its texts are German when the profile's `locale` is German, English otherwise.

Every page with a stable link has a link icon after its title, and every row of the index has one
after the address; it copies the stable link at the address the site is served from. On the
published site, that is the address **Copy Stable Link** copies in VS Code from `site.url`; in
`mkdocs serve` or a preview deployment, it points at that copy of the site. The buttons work with Material's instant navigation. To leave them out, set
`COPY_BUTTONS = False` at the top of the hook.

## Retired pages

A page whose id must not be reused is retired instead of deleted (see
[Retiring pages](../../user-guide.md#retiring-pages)). For pages with `lifecycle: Retired`, the hook

- leaves them out of the navigation and the previous and next links, like `not_in_nav`, so the
  menu shows only current content. They keep their address and stay in the search: whoever looks
  for the old term finds it and is sent on to its successor;
- adds a notice below the title, *Retired: This page is no longer maintained. Replaced by Value
  stream (BOK-2).*, with links to the pages whose ids are named in `replaced_by` (a single id or
  a list);
- marks them as *(Retired)* on the index page.

Field and values are set at the top of the hook (`RETIRED_FIELD`, `RETIRED_VALUES`,
`SUCCESSOR_FIELD`); match them to the profile's collections. `HIDE_RETIRED = False` keeps retired
pages in the navigation, `RETIRED_NOTICE = False` leaves the notice out. A page that an explicit
`nav` in `mkdocs.yml` lists stays there. The notice uses the theme's admonition style.

In VS Code, **Copy Stable Link** copies `https://docs.example.org/id/BOK-2/` for that page. The value
is percent-encoded the same way in both places.

The hook only reads the profile and the front matter and only writes below `site_dir`. It runs
with `mkdocs build` and `mkdocs serve`.

## Try it

`samples/demo` has a `mkdocs.yml` that uses the hook from this directory. From the repository root:

```bash
python3 -m venv .venv
.venv/bin/pip install -r docs/examples/mkdocs/requirements.txt
.venv/bin/mkdocs serve -f samples/demo/mkdocs.yml
```

The log shows `Wrote 4 stable links.` Then:

- <http://127.0.0.1:8000/id/> lists BOK-1, BOK-2, BOK-4, and DEC-1 with their titles; the link icons
  copy `http://127.0.0.1:8000/id/…`, as does the icon after the title of *Value stream*.
- <http://127.0.0.1:8000/id/BOK-2/> opens *Value stream*, and `/id/BOK-2/#anchor` keeps the anchor.
- Move `samples/demo/docs/terms/value-stream.md` to another directory: after the rebuild,
  `/id/BOK-2/` opens the page at its new location.
- Give a second page `id: BOK-2`: the log warns that both pages share the value, `/id/BOK-2/`
  is no longer written, and `/id/` lists it under *Not written*.
- *Process map* (BOK-4) is retired: it is missing from the menu, `/id/BOK-4/` still opens
  it with a notice that links to *Value stream*, and the search finds it.

Undo the changes with `git checkout -- samples/demo && git clean -fd samples/demo/docs`.
`.venv/` and the built `samples/demo/site/` are ignored by Git.
