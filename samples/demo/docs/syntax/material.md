---
title: Material for MkDocs
aliases: [Admonitions, Tabs]
---

# Material for MkDocs

Constructs of [Material for MkDocs](https://squidfunk.github.io/mkdocs-material/). Lorequill keeps
them unchanged; the preview approximates them.

## Admonitions

!!! note
    Without a title: the type is used as the title.

!!! tip "Custom title"
    With a title, **emphasis**, and a link to the [overview](../index.md).

!!! warning ""
    Empty title: only the content.

!!! danger "Danger"
    Several paragraphs.

    Second paragraph with a list:

    - Item A
    - Item B

!!! info inline end "Several words in the type"
    `inline end` stands for the position at the margin.

!!! example "Code in an admonition"
    ```yaml
    title: Example
    ```

!!! quote
    > A quote in an admonition.

## Collapsible blocks

??? question "Closed"
    Visible only after a click.

???+ success "Open"
    Visible from the start.

## Nested

!!! note "Outer"
    Outer text.

    ??? abstract "Inner"
        Inner text with a [link](gfm.md#tables).

        !!! bug "Innermost"
            Three levels deep.

- A list with an admonition:

    !!! tip
        In a list item.

## Tabs

=== "Linux"
    ```shell
    sudo apt install code
    ```

=== "macOS"
    ```shell
    brew install --cask visual-studio-code
    ```

===+ "Windows"
    Selected by `===+`.

===! "New group"
    `===!` starts a new tab group.

=== "Second tab"
    With an admonition:

    !!! note
        In a tab.

## Attribute lists

## Heading with a custom ID {#custom-id}

A paragraph with a class.
{ .lead }

[Button](../index.md){ .md-button }

## Snippets

A snippet includes another file when the site is built. Lorequill shows the line unchanged:

--8<-- "includes/abbreviations.md"

## More extensions

Keys ++ctrl+alt+del++, ==marked==, ^^inserted^^, H~2~O, emoji :smile:, and abbreviations like
HTML stay as text.

*[HTML]: Hypertext Markup Language
