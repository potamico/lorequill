---
title: GitHub Flavored Markdown
aliases: [GFM]
---

# GitHub Flavored Markdown

The extensions of [GFM](https://github.github.com/gfm/) to [CommonMark](commonmark.md).

## Tables

| Left | Centered | Right | No alignment |
| :--- | :------: | ----: | ------------ |
| Text | `Code`   | 1,234 | **bold**     |
| Ä    | é        | 5     | [Link](../index.md) |
| Pipe \| in text | | 0.5 | empty cell on the left |

## Task lists

- [x] Create the profile
- [x] Write pages
- [ ] Request a review
  - [ ] Nested task
  - [x] Completed nested task

## Strikethrough

~~struck through~~ and ~single tilde~.

## Autolinks

www.example.com, https://example.com/path?query=1, and info@example.com become links without
angle brackets.

## Footnotes

Lorequill checks links before the commit.[^check] Footnotes can also be named.[^name]

[^check]: The commit check runs against the staged state.
[^name]: A named footnote with **emphasis** and a [link](commonmark.md).
