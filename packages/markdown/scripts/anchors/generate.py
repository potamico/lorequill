"""Generates heading-anchor fixtures with the real Python-Markdown toolchain used by MkDocs.

Run from the repository root (see packages/markdown/README.md):

    python3 -m venv /tmp/anchors-venv
    /tmp/anchors-venv/bin/pip install -r packages/markdown/scripts/anchors/requirements.txt
    /tmp/anchors-venv/bin/python -I packages/markdown/scripts/anchors/generate.py

The output, fixtures/anchors/python-markdown.json, is committed. Tests compare the TypeScript
anchor algorithm against it, so neither Python nor these packages are needed to run the tests.
"""

import json
import re
import sys
from importlib.metadata import version
from pathlib import Path

import markdown
from markdown.extensions.toc import slugify as toc_slugify
from pymdownx.slugs import slugify as pymdownx_slugify

ROOT = Path(__file__).resolve().parents[4]
OUTPUT = ROOT / "fixtures" / "anchors" / "python-markdown.json"

# Extensions of a typical Material for MkDocs site that affect headings and containers.
EXTENSIONS = [
    "toc",
    "attr_list",
    "admonition",
    "pymdownx.details",
    "pymdownx.superfences",
    "pymdownx.tabbed",
]

VARIANTS = {
    # Default slugify of the toc extension, which MkDocs uses unless configured otherwise.
    "ascii": toc_slugify,
    # pymdownx.slugs Unicode slugify in lower case, as recommended by Material for MkDocs.
    "unicode": pymdownx_slugify(case="lower"),
}

SINGLE_HEADINGS = [
    "Hello World",
    "Identität & Rollen",
    "Ärger über Öl",
    "Straße",
    "Émile Zola",
    "Ünïcödé",
    "Ελληνικά κείμενα",
    "日本語の見出し",
    "C++ / C# / F#",
    "100% sure!",
    "--Dashes--",
    "under_score",
    "Mixed CASE Words",
    "Dots.in.name",
    "Apostrophe's test",
    'Quotes "double"',
    "a/b\\c",
    "1. Numbered",
    "Tab\there",
    "Multiple   spaces",
    "Non breaking",
    "Emoji 🎉 party",
    "!!!",
    "Hello *emphasis* and **strong**",
    "The `foo()` function",
    "A [link](page.md) inside",
    "An ![image](pic.png) inside",
    "Inline <em>html</em> tag",
    "Entity &amp; reference",
    "Escaped \\*stars\\*",
    "Trailing hashes ##",
    "Title {#custom-id}",
    "Title { #spaced-id }",
    "Title {: #colon-id .cls }",
    "Title {: .only-class }",
    "Ends with dash -",
    "Wörter-mit-Bindestrich",
    "Numbers 2026 and year",
]

DOCUMENTS = {
    "duplicates": "# Foo\n\n## Foo\n\n### Foo\n",
    "duplicate-suffix-collision": "# Foo\n\n# Foo_1\n\n# Foo\n",
    "explicit-id-collides-with-later-heading": "# First {#bar}\n\n# Bar\n",
    "explicit-id-collides-with-earlier-heading": "# Bar\n\n# Second {#bar}\n",
    "setext": "Setext One\n==========\n\nSetext Two\n----------\n",
    "admonition": '!!! note "Note"\n    ## Inside Admonition\n\n    Text.\n\n## After\n',
    "details": '??? tip "More"\n    ## Inside Details\n',
    "tabs": '=== "Tab A"\n\n    ## Inside Tab\n\n=== "Tab B"\n\n    Text.\n',
    "code-is-ignored": "```\n# Not a heading\n```\n\n# Real\n",
    "empty-heading-text": "# !!!\n\n# ???\n",
}


def heading_ids(text, slugify):
    html = markdown.markdown(
        text, extensions=EXTENSIONS, extension_configs={"toc": {"slugify": slugify}}
    )
    return re.findall(r'<h[1-6][^>]*\bid="([^"]*)"', html)


def main():
    cases = []
    for heading in SINGLE_HEADINGS:
        cases.append({"name": heading, "markdown": f"# {heading}\n"})
    for name, text in DOCUMENTS.items():
        cases.append({"name": name, "markdown": text})
    for case in cases:
        for variant, slugify in VARIANTS.items():
            case[variant] = heading_ids(case["markdown"], slugify)
    result = {
        "generator": "packages/markdown/scripts/anchors/generate.py",
        "versions": {
            "python": sys.version.split()[0],
            "markdown": version("markdown"),
            "pymdown-extensions": version("pymdown-extensions"),
        },
        "extensions": EXTENSIONS,
        "cases": cases,
    }
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"wrote {len(cases)} cases to {OUTPUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
