---
title: Link types
aliases: [Links, Anchors]
---

# Link types

Every kind of link that the check `relative-links` accepts. Ctrl+click opens the target,
**Insert Link** writes links in the same form.

## Relative page links

- Same level: [Targets](targets.md)
- Parent: [Welcome](../index.md)
- Subfolder of another branch: [Identity](../basics/identity.md)
- With spaces in the name: [File with spaces](<file with spaces.md>) and
  [encoded](file%20with%20spaces.md)
- Other files in the content folder: [Diagram](../assets/diagram.svg)

## Anchors

- On this page: [Relative page links](#relative-page-links)
- On another page: [Tables](../syntax/gfm.md#tables)
- With an accent (profile `slugify: unicode`): [Café](targets.md#café-and-crème-brûlée)
- Duplicate heading, second occurrence: [Example](targets.md#example_1)
- Custom ID from an attribute list: [Custom ID](../syntax/material.md#custom-id)

## Reference links

A [full reference link][targets], a [collapsed][] one, and a [targets] without brackets. A
definition is checked once, however often it is used.

[targets]: targets.md "Targets"
[collapsed]: targets.md#example

## External targets

External links are never fetched: [MkDocs](https://www.mkdocs.org/),
[unencrypted](http://example.com/), [email](mailto:docs@example.com).

## Links in code are not links

`[not checked](missing.md)`

```markdown
[not checked either](missing.md)
```
