# @lorequill/checks

The Lorequill check engine, CLI, and Action entry point (specification §11 and §14). The same
engine runs in the editor (through the language server), on the command line, and in CI. It reads
an immutable snapshot of the content root, never writes, and never executes repository code.

The rules, guarantees, and the CLI are described in the
[checks reference](../../docs/reference/checks.md), the Action in
[CI with GitHub Actions](../../docs/reference/ci.md).

This package has no dependency on VS Code. It is an internal workspace package (`private`)
consumed as TypeScript source; `npm run build` bundles the CLI into `dist/cli.cjs` and the Action
into `action/dist/index.cjs`.

## API

```ts
import { createFileSystemSnapshot, runChecks, withOverrides } from "@lorequill/checks";

const snapshot = createFileSystemSnapshot("/repo/docs");
const result = await runChecks({ profile, snapshot, signal });
// { status: "passed" | "failed" | "error", findings, error?, engineVersion, snapshotId, pagesChecked }

// Unsaved editor buffers on top of the files on disk:
await runChecks({ profile, snapshot: withOverrides(snapshot, new Map([["a.md", text]])) });
```

A finding has the check `id` from the profile, the rule name, a stable `code`, `params`, an English
`message`, a repository-relative POSIX `path`, a 1-based `line`, and an optional `column`. Every
finding is an error in profile version 1.

The snapshot identifier is a SHA-256 over the listed file paths and the content of every text the
run read (pages and anchor targets). Findings are sorted by path in code-unit order.

## Tests

Unit tests in `test/unit` use in-memory snapshots. `cli.test.ts` bundles the CLI with esbuild and
runs it as a child process against temporary repositories. `budget.test.ts` checks 1,000 pages
plus a 1 MiB page within 30 seconds (about 4 seconds on a development machine; decision D7).
