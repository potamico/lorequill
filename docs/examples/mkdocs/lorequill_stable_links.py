"""MkDocs hook: stable links to pages by a front matter field.

For every page whose front matter has the field named in ``site.stable_links.field`` of the
Lorequill profile (``.lorequill/config.yaml`` next to ``mkdocs.yml``), the build writes a small
redirect page at ``site.stable_links.path`` with ``{value}`` replaced by the field's value, for
example ``id/BOK-2/`` -> ``terms/value-stream/``. When a page moves, the next build points the
same address at the new location; nothing has to be maintained by hand.

When the path has a directory before ``{value}`` (``id/{value}/`` -> ``id/``), that directory
gets an index page listing every stable link with the page's title, rendered with the site's
theme (MkDocs 1.6 or later). Set ``WRITE_INDEX`` below to ``False`` to leave it out.

Every page with a stable link, and every row of the index, gets a button that copies the link:
at the address the site is served from, so it also works in ``mkdocs serve`` and in preview
deployments; on the published site it is the same address VS Code's **Copy Stable Link** builds
from ``site.url``. Set ``COPY_BUTTONS`` to ``False`` to leave them out.

Retired pages (``RETIRED_FIELD`` is one of ``RETIRED_VALUES``, by default ``lifecycle:
Retired``) keep their address and stay in the search, but leave the navigation, so that their id
is never reused without cluttering the menu. Each gets a notice below its title that links to
the pages named in ``SUCCESSOR_FIELD`` (by default ``replaced_by``), and the index marks them.
Set ``HIDE_RETIRED`` or ``RETIRED_NOTICE`` to ``False`` to leave either out. A page listed in an
explicit ``nav`` of ``mkdocs.yml`` stays there.

Usage, in ``mkdocs.yml`` (MkDocs 1.4 or later)::

    hooks:
      - hooks/lorequill_stable_links.py

The hook only reads the profile and the pages' front matter, and only writes below ``site_dir``.
Values that cannot be a single path segment (empty, ``.``, ``..``, or containing ``/``, ``\\``,
or control characters) and values used by more than one page are skipped with a warning; the
Lorequill check ``unique-field`` reports duplicates before they reach the build.
"""

from __future__ import annotations

import html
import logging
import os
import posixpath
import re
from typing import Any
from urllib.parse import quote

import yaml

log = logging.getLogger("mkdocs.hooks.lorequill_stable_links")

#: Whether to add the index page that lists all stable links.
WRITE_INDEX = True
#: Whether to add buttons that copy a page's stable link.
COPY_BUTTONS = True
#: The front matter field and values that mark a page as retired, and the field that names the
#: stable link values (ids) of its successors; match them to the profile's collections.
RETIRED_FIELD = "lifecycle"
RETIRED_VALUES = ("Retired",)
SUCCESSOR_FIELD = "replaced_by"
#: Whether retired pages leave the navigation, and whether they get a notice below their title.
HIDE_RETIRED = True
RETIRED_NOTICE = True

PROFILE = os.path.join(".lorequill", "config.yaml")
UNSAFE = re.compile(r"[/\\\x00-\x1f\x7f]")
MARKDOWN_SPECIAL = re.compile(r"([\\`*_{}\[\]<>()#+!|])")

TEXT = {
    "en": {
        "title": "Stable links",
        "intro": "These addresses stay valid when a page moves.",
        "value": "Address",
        "page": "Page",
        "skipped": "Not written",
        "skipped-intro": "These values have no stable link:",
        "shared": "shared by {pages}",
        "invalid": "cannot be part of an address ({page})",
        "none": "No page has a value yet.",
        "copy": "Copy stable link",
        "copied": "Copied",
        "retired": "Retired",
        "retired-text": "This page is no longer maintained.",
        "replaced-by": "Replaced by {pages}.",
    },
    "de": {
        "title": "Stabile Links",
        "intro": "Diese Adressen bleiben gültig, auch wenn eine Seite verschoben wird.",
        "value": "Adresse",
        "page": "Seite",
        "skipped": "Nicht geschrieben",
        "skipped-intro": "Für diese Werte gibt es keinen stabilen Link:",
        "shared": "von mehreren Seiten verwendet: {pages}",
        "invalid": "kann nicht Teil einer Adresse sein ({page})",
        "none": "Noch keine Seite hat einen Wert.",
        "copy": "Stabilen Link kopieren",
        "copied": "Kopiert",
        "retired": "Veraltet",
        "retired-text": "Diese Seite wird nicht mehr gepflegt.",
        "replaced-by": "Ersetzt durch {pages}.",
    },
}

COPY_ICONS = (
    '<svg class="lq-icon-link" viewBox="0 0 24 24" aria-hidden="true">'
    '<path d="M10 13a5 5 0 0 0 7.07 0l3-3a5 5 0 0 0-7.07-7.07l-1.5 1.5"/>'
    '<path d="M14 11a5 5 0 0 0-7.07 0l-3 3a5 5 0 0 0 7.07 7.07l1.5-1.5"/></svg>'
    '<svg class="lq-icon-done" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12l5 5L20 7"/></svg>'
)

# Added to every page; the click handler is delegated and registered once, so it also works
# with Material's instant navigation, which swaps the content without running new scripts.
COPY_ASSETS = """<style>
.lq-stable-copy{background:none;border:0;padding:0 .15em;margin:0 0 0 .25em;cursor:pointer;
color:inherit;opacity:.4;font-size:.75em;line-height:1;vertical-align:middle;border-radius:.2em}
.lq-stable-copy:hover,.lq-stable-copy:focus-visible{opacity:1}
.lq-stable-copy svg{width:1em;height:1em;fill:none;stroke:currentColor;stroke-width:2;
stroke-linecap:round;stroke-linejoin:round;vertical-align:-.125em}
.lq-stable-copy .lq-icon-done,.lq-stable-copy.lq-copied .lq-icon-link{display:none}
.lq-stable-copy.lq-copied .lq-icon-done{display:inline}
.lq-stable-copy.lq-copied{opacity:1}
</style>
<script>
(function () {
  if (window.lqStableCopy) return;
  window.lqStableCopy = true;
  function copy(text) {
    if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(text);
    return new Promise(function (resolve, reject) {
      var area = document.createElement("textarea");
      area.value = text;
      area.setAttribute("readonly", "");
      area.style.position = "fixed";
      area.style.opacity = "0";
      document.body.appendChild(area);
      area.select();
      var done = document.execCommand("copy");
      document.body.removeChild(area);
      done ? resolve() : reject();
    });
  }
  document.addEventListener("click", function (event) {
    var button = event.target.closest && event.target.closest(".lq-stable-copy");
    if (!button) return;
    event.preventDefault();
    var url = new URL(button.getAttribute("data-url"), location.href).href;
    copy(url).then(function () {
      var title = button.getAttribute("title");
      button.classList.add("lq-copied");
      button.setAttribute("title", button.getAttribute("data-copied"));
      setTimeout(function () {
        button.classList.remove("lq-copied");
        button.setAttribute("title", title);
      }, 1500);
    });
  });
})();
</script>
"""

_settings: dict[str, str] | None = None
_index: Any = None
# Case-folded value -> (value as written, page).
_targets: dict[str, tuple[str, Any]] = {}
# Case-folded value -> (value as written, the pages that share it).
_conflicts: dict[str, tuple[str, list[Any]]] = {}
# (value as written, page) for values that cannot be an address.
_invalid: list[tuple[str, Any]] = []
# Source paths of retired pages, from their front matter.
_retired: set[str] = set()


def on_config(config: Any, **_: Any) -> Any:
    global _settings
    _settings = _read_settings(os.path.dirname(config["config_file_path"]))
    return config


def on_pre_build(**_: Any) -> None:
    # `mkdocs serve` rebuilds in the same process: start every build from scratch.
    _targets.clear()
    _conflicts.clear()
    _invalid.clear()
    _retired.clear()


def on_files(files: Any, *, config: Any, **_: Any) -> Any:
    global _index
    _index = None
    _mark_retired(files)
    directory = _index_directory()
    if directory is None:
        return files
    try:
        from mkdocs.structure.files import File
    except ImportError:  # pragma: no cover - MkDocs always has it
        return files
    if not hasattr(File, "generated"):
        log.info("The stable links index needs MkDocs 1.6 or later; it is left out.")
        return files
    src_uri = directory + "index.md"
    if files.get_file_from_path(src_uri) is not None:
        log.warning("%s exists; the stable links index is left out.", src_uri)
        return files
    # Appended last, so it is rendered after every other page and sees their titles.
    _index = File.generated(config, src_uri, content="")
    files.append(_index)
    return files


def on_page_markdown(markdown: str, *, page: Any, **_: Any) -> str:
    if _settings is None:
        return markdown
    if _index is not None and page.file.src_uri == _index.src_uri:
        return _index_markdown(page)
    value = page.meta.get(_settings["field"])
    if isinstance(value, bool) or not isinstance(value, (str, int, float)):
        return markdown
    text = str(value).strip()
    if text in ("", ".", "..") or UNSAFE.search(text):
        log.warning("Page %s: %s %r cannot be a stable link.", page.file.src_uri, _settings["field"], text)
        _invalid.append((text, page))
        return markdown
    key = text.casefold()
    if key in _conflicts:
        _conflicts[key][1].append(page)
        return markdown
    if key in _targets and _targets[key][1].url != page.url:
        other = _targets.pop(key)[1]
        log.warning(
            "Pages %s and %s share %s %r; no stable link is written for it.",
            other.url or "/",
            page.url or "/",
            _settings["field"],
            text,
        )
        _conflicts[key] = (text, [other, page])
        return markdown
    _targets[key] = (text, page)
    return markdown


def on_post_page(output: str, *, page: Any, **_: Any) -> str:
    # Runs after every page's Markdown is read, so shared values and successors are known by now.
    if _settings is None:
        return output
    if "</h1>" not in output:
        return _with_copy_assets(output)
    is_index = _index is not None and page.file.src_uri == _index.src_uri
    # The directory the page is served from: `a/b/` for `a/b/`, `a` for `a/b.html`.
    url = page.url
    directory = url.rstrip("/") if url == "" or url.endswith("/") else posixpath.dirname(url)
    before, heading_end, after = output.partition("</h1>")
    if RETIRED_NOTICE and not is_index and _is_retired(page.meta):
        after = _retired_notice(page, directory) + after
    if COPY_BUTTONS:
        value = next(
            (value for value, target in _targets.values() if target.file.src_uri == page.file.src_uri),
            None,
        )
        if value is not None and not is_index:
            before += _copy_button(value, directory)
    return _with_copy_assets(before + heading_end + after)


def _with_copy_assets(output: str) -> str:
    # On every page: with instant navigation, the page a reader enters on keeps its scripts.
    if not COPY_BUTTONS or "</body>" not in output:
        return output
    head, body_end, tail = output.rpartition("</body>")
    return head + COPY_ASSETS + body_end + tail


def on_post_build(*, config: Any, **_: Any) -> None:
    if _settings is None:
        return
    site_dir = os.path.abspath(config["site_dir"])
    written = 0
    for value, page in _targets.values():
        address = _settings["path"].replace("{value}", value)
        file = address + "index.html" if address.endswith("/") else address
        target = os.path.abspath(os.path.join(site_dir, *file.split("/")))
        if os.path.commonpath([site_dir, target]) != site_dir:
            continue
        os.makedirs(os.path.dirname(target), exist_ok=True)
        with open(target, "w", encoding="utf-8") as handle:
            handle.write(_redirect(_relative(posixpath.dirname(file), page.url)))
        written += 1
    log.info("Wrote %d stable links.", written)


def stable_address(path: str, value: str) -> str:
    """The URL path of a stable link, encoded like JavaScript's encodeURIComponent."""
    return path.replace("{value}", quote(value, safe="!*'()"))


def _read_settings(directory: str) -> dict[str, str] | None:
    try:
        with open(os.path.join(directory, PROFILE), encoding="utf-8") as handle:
            profile = yaml.safe_load(handle)
    except OSError:
        log.warning("No Lorequill profile at %s; no stable links are written.", PROFILE)
        return None
    profile = profile if isinstance(profile, dict) else {}
    links = (profile.get("site") or {}).get("stable_links")
    if not isinstance(links, dict) or not isinstance(links.get("field"), str):
        return None
    path = links.get("path")
    if not isinstance(path, str) or path.count("{value}") != 1 or path.startswith("/"):
        log.warning("site.stable_links.path of the Lorequill profile is invalid.")
        return None
    locale = profile.get("locale")
    language = "de" if isinstance(locale, str) and locale.lower().startswith("de") else "en"
    return {"field": links["field"], "path": path, "language": language}


def _index_directory() -> str | None:
    """`id/` for the path `id/{value}/`; None when the path has no directory of its own."""
    if not WRITE_INDEX or _settings is None:
        return None
    prefix = _settings["path"].split("{value}")[0]
    if not prefix.endswith("/") or prefix.strip("/") == "":
        return None
    return prefix


def _index_markdown(index: Any) -> str:
    """The index page: a table of every stable link, then the values that have none."""
    assert _settings is not None
    text = TEXT[_settings["language"]]
    directory = posixpath.dirname(index.file.src_uri)
    lines = [f"# {text['title']}", "", text["intro"], ""]
    entries = sorted(_targets.values(), key=lambda entry: entry[0].casefold())
    if entries:
        lines += [f"| {text['value']} | {text['page']} |", "| --- | --- |"]
        for value, page in entries:
            address = _settings["path"].replace("{value}", value)
            relative = posixpath.relpath(address, directory)
            if address.endswith("/"):
                relative += "/" if index.file.use_directory_urls else "/index.html"
            # Inline HTML, so MkDocs does not report the address as a link to a missing file.
            link = f'<a href="{html.escape(quote(relative, safe="/!*()~-._"))}">{html.escape(value)}</a>'
            button = _copy_button(value, directory)
            retired = f" ({text['retired']})" if page.file.src_uri in _retired else ""
            lines.append(f"| {link}{button} | {_page_link(page, directory)}{retired} |")
    else:
        lines.append(text["none"])
    skipped = [
        (value, text["shared"].format(pages=", ".join(_page_link(page, directory) for page in pages)))
        for value, pages in _conflicts.values()
    ] + [(value, text["invalid"].format(page=_page_link(page, directory))) for value, page in _invalid]
    if skipped:
        lines += ["", f"## {text['skipped']}", "", text["skipped-intro"], ""]
        for value, reason in sorted(skipped, key=lambda entry: entry[0].casefold()):
            lines.append(f"- `{value.replace('`', '')}`: {reason}")
    return "\n".join(lines) + "\n"


def _copy_button(value: str, directory: str) -> str:
    """A button that copies the stable link of `value`; `directory` is where the page is served."""
    assert _settings is not None
    text = TEXT[_settings["language"]]
    address = stable_address(_settings["path"], value)
    # Relative, so the browser resolves it against wherever the site is served.
    url = posixpath.relpath(address, directory or ".")
    if address.endswith("/") and not url.endswith("/"):
        url += "/"
    return (
        f' <button type="button" class="lq-stable-copy" data-url="{html.escape(url)}"'
        f' data-copied="{html.escape(text["copied"])}" title="{html.escape(text["copy"])}"'
        f' aria-label="{html.escape(text["copy"])}: {html.escape(value)}">{COPY_ICONS}</button>'
    )


def _is_retired(meta: Any) -> bool:
    value = meta.get(RETIRED_FIELD) if isinstance(meta, dict) else None
    return isinstance(value, str) and value.strip() in RETIRED_VALUES


def _mark_retired(files: Any) -> None:
    """Records retired pages and, with HIDE_RETIRED, leaves them out of the navigation.

    MkDocs builds the navigation before it reads the pages, so the front matter is read here. The
    pages are marked like `not_in_nav`: built and searchable, but not in the menu nor in the
    previous and next links.
    """
    try:
        from mkdocs.structure.files import InclusionLevel
        from mkdocs.utils.meta import get_data
    except ImportError:  # MkDocs before 1.6
        InclusionLevel = None  # noqa: N806
        from mkdocs.utils.meta import get_data
    for file in files.documentation_pages():
        try:
            text = file.content_string
        except (AttributeError, OSError, UnicodeDecodeError):
            continue
        try:
            _, meta = get_data(text)
        except Exception:  # noqa: BLE001 - invalid front matter: MkDocs reports it itself
            continue
        if not _is_retired(meta):
            continue
        _retired.add(file.src_uri)
        if HIDE_RETIRED and InclusionLevel is not None and file.inclusion == InclusionLevel.INCLUDED:
            file.inclusion = InclusionLevel.NOT_IN_NAV


def _retired_notice(page: Any, directory: str) -> str:
    """The notice below a retired page's title, with links to its successors."""
    assert _settings is not None
    text = TEXT[_settings["language"]]
    successors = page.meta.get(SUCCESSOR_FIELD)
    values = successors if isinstance(successors, list) else [successors]
    links = []
    for value in values:
        if isinstance(value, bool) or not isinstance(value, (str, int, float)) or str(value).strip() == "":
            continue
        name = str(value).strip()
        target = _targets.get(name.casefold())
        if target is None:
            links.append(html.escape(name))
            continue
        successor = target[1]
        href = html.escape(_relative(directory, successor.url))
        title = html.escape(str(successor.title or name))
        links.append(f'<a href="{href}">{title}</a> ({html.escape(name)})')
    body = html.escape(text["retired-text"])
    if links:
        body += " " + html.escape(text["replaced-by"]).replace("{pages}", ", ".join(links))
    return (
        '\n<div class="admonition warning lq-retired">'
        f'<p class="admonition-title">{html.escape(text["retired"])}</p>'
        f"<p>{body}</p></div>\n"
    )


def _page_link(page: Any, directory: str) -> str:
    """A Markdown link to a page's source, which MkDocs resolves to the page's URL."""
    title = page.title or page.file.src_uri
    target = posixpath.relpath(page.file.src_uri, directory or ".")
    label = MARKDOWN_SPECIAL.sub(r"\\\1", str(title))
    return f"[{label}](<{target}>)"


def _relative(from_directory: str, url: str) -> str:
    """The link from a redirect page in `from_directory` to the page `url` (both site-relative)."""
    relative = posixpath.relpath(url or ".", from_directory or ".")
    if (url == "" or url.endswith("/")) and not relative.endswith("/"):
        relative += "/"
    # MkDocs page URLs are already percent-encoded; `%` stays as it is.
    return quote(relative, safe="/!*'()~-._%#")


def _redirect(target: str) -> str:
    escaped = html.escape(target, quote=True)
    script = target.replace("\\", "\\\\").replace('"', '\\"').replace("<", "\\u003c")
    return (
        "<!doctype html>\n"
        '<html><head><meta charset="utf-8"><title>Redirect</title>\n'
        '<meta name="robots" content="noindex">\n'
        f'<link rel="canonical" href="{escaped}">\n'
        f'<meta http-equiv="refresh" content="0; url={escaped}">\n'
        f'<script>location.replace("{script}" + location.hash);</script>\n'
        f'</head><body><a href="{escaped}">{escaped}</a></body></html>\n'
    )
