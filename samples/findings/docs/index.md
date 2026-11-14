---
title: Deliberate errors
---

# Deliberate errors

Every other page in this sample breaks a check rule. This page itself has no errors.

- [Broken links](links.md): `relative-links`
- [Forbidden text](forbidden-text.md): `forbidden-text`
- [Duplicate id A](id-a.md) and [B](id-b.md), [id as a list](id-list.md):
  `unique-field`
- [Values not allowed](values.md): `allow-values`
- [Decision with a wrong id](decisions/wrong-id.md) and
  [without an id](decisions/no-id.md): `field-format`
- [Retired without a successor](retired-no-successor.md), [with an unknown one](retired-unknown.md),
  [with itself](retired-self.md), and [with a nested successor](retired-nested.md):
  `reference-field`
- [Broken front matter](front-matter.md)
