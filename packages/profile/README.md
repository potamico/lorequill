# @lorequill/profile

Closed JSON Schema, generated TypeScript types, validator, and loader for the Lorequill repository
profile (`.lorequill/config.yaml`, profile version 1). Specification: sections 6, 9, 11, and 15.

What a profile may contain, its limits, and the glob rules of the content scope are described in
the [profile reference](../../docs/reference/profile.md).

This package has no dependency on VS Code. It is used by the extension, the language server, and
the check CLI. It is an internal workspace package (`private`) consumed as TypeScript source.

## API

```ts
import { loadProfile, parseProfile } from "@lorequill/profile";

// From text (for example the content of an open editor):
const result = parseProfile(yamlText);

// From a workspace folder; reads <root>/.lorequill/config.yaml safely:
const loaded = await loadProfile(workspaceRoot);

if (result.ok) {
  result.profile; // typed `Profile`
} else {
  result.issues; // [{ code, path, line?, column?, params? }]
}
```

Issues carry a stable `code` (also the English message key for translation catalogs), a JSON
Pointer `path`, an optional 1-based `line` and `column`, and `params` for message placeholders. The
package never produces localized text. Rejected scalar values are not copied into issues, with the
exception of unknown rule and widget names and the unsupported version number.

Defaults are applied by consumers, not injected into the parsed profile; the default timeout is
exported as `DEFAULT_CHECK_TIMEOUT_SECONDS`.

## Content scope

`createContentScope(profile.content)` returns `isIncluded(relativePath)`, which decides whether a
file below the content root is a page, and `isDraft(relativePath)`, which tells whether it matches
a `content.drafts` pattern. `listContentFiles` lists the files of a content root breadth first, as
the Pages tree and the check engine both need them (decisions D16, D17, D33).

## Generated types

`src/generated/profile.ts` is generated from `schema/profile.schema.json` and is committed.

```bash
npm run generate:types --workspace @lorequill/profile   # regenerate
npm run check:types --workspace @lorequill/profile      # fail if stale
```

A unit test fails when the committed file differs from the generator output.

## Tests

Unit tests live in `test/unit`; shared fixtures live in the repository's `fixtures/profiles`
directory (`valid`, `hostile`). One test file validates the profiles printed in the specification
and in the EA Body of Knowledge example. It reads those documents only to check that the schema
accepts them; product behavior does not depend on the example.
