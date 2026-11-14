# Example: EA Body of Knowledge profile

This companion document is informative, not normative. The Lorequill product must not hard-code these paths, field values, or collection templates.

## Repository mapping

The example repository uses Markdown under `docs/identity-access`, `docs/ea-governance`, and `docs/method/decisions`. Collections can include concepts, patterns, principles, standards, guidelines, reference architectures, decisions, and ADRs. The target repository's metadata schema remains authoritative for its fields.

Knowledge-object lifecycle values: `Draft`, `In Review`, `Approved`, `Retired`. A retired object keeps its page with `Retired` and, where one exists, the id of its successor in `replaced_by`; ids are never reused. Decision lifecycle values: `Proposed`, `Accepted`, `Superseded`, `Withdrawn`.

## Example repository profile

```yaml
version: 1
locale: en

content:
  root: docs
  include: ["**/*.md"]
  exclude:
    - "**/index.md"
    - "admin/**"
    - "method/authoring/**"

review:
  base_branch: main

site:
  url: https://docs.example.org/
  stable_links: { field: id, path: "id/{value}/" }

checks:
  timeout_seconds: 30
  rules:
    - { id: wikilinks, rule: forbidden-text, text: "[[" }
    - { id: unique-ids, rule: unique-field, field: id }
    - id: relations
      rule: allow-values
      marker: "rel:"
      values: [related, supports, contradicts, implements]
    - id: export-refs
      rule: relative-links
      anchors: true
      slugify: unicode
    - id: concept-ids
      rule: field-format
      when: { field: type, in: [concept] }
      field: id
      prefixes: [BOK]
    - id: decision-ids
      rule: field-format
      when: { field: type, in: [decision, adr] }
      field: id
      prefixes: [DEC, ADR]
    - id: successors
      rule: reference-field
      when: { field: lifecycle, in: [Retired] }
      field: replaced_by
      target: id
      required: true

collections:
  - id: concept
    label: Concept
    folder: "{domain}/concepts"
    match: { field: type, equals: concept }
    template: |
      # {title}

      ## Definition

      ## Purpose

      ## Scope

      ## Relations

      ## Standards
    fields:
      - { key: title, label: Title, widget: string, required: true }
      - { key: type, widget: hidden, default: concept }
      - { key: id, label: ID, widget: string, required: true }
      - { key: domain, widget: hidden, default: "{domain}" }
      - key: lifecycle
        label: Lifecycle
        widget: select
        default: Draft
        options: [Draft, "In Review", Approved, Retired]
      - { key: replaced_by, label: Replaced by, widget: string }
      - { key: aliases, label: Aliases, widget: list }
```

## Repository-specific checks

Navigation, metadata-schema conformance, and the actual MkDocs site build remain in the repository's own CI pipeline. `index.md` is excluded by this example profile but may be included by other profiles. Renderer-specific heading-anchor behavior must be tested against the actual site build.

## Markdown preservation fixtures

The product's generic tests should include representative Markdown for Material for MkDocs admonitions (`!!!`), collapsible blocks (`???`), tabs, snippets (`--8<--`), attribute lists (`{#id}`), task markers, and fenced code. These are preservation fixtures, not a requirement to implement the corresponding renderer in CodeMirror.
