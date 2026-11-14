# @lorequill/editor

The Lorequill page editor (specification §7 and §8): a CodeMirror 6 webview over VS Code's
`TextDocument`, and the protocol that keeps both in sync. This package has no dependency on VS
Code; the extension bundles `src/webview/main.ts` into `dist/webview/main.js`.

## Synchronization

The `TextDocument` is authoritative; CodeMirror is a view of it. Positions in messages are
0-based lines and UTF-16 characters, so CRLF documents need no offset conversion.

- The webview sends `edit` messages with an `id` and the document version they are based on. The
  host applies an edit through `WorkspaceEdit` only if that version is still current and answers
  `ack` with the new version; otherwise it answers `reject`. A stale edit can therefore never
  overwrite newer text.
- Every other document change (undo, redo, other editors, the properties panel, disk) reaches the
  webview as `update`. If an edit is in flight at that moment, it is known to be rejected:
  `SyncClient` rebases the local changes over the host changes (CodeMirror change-set mapping) and
  sends them again.
- CodeMirror's history extension is not used. Undo and redo are VS Code's, on the document.
- After a reload, the webview sends `ready` and receives the complete document (`init`).

`test/unit/sync.test.ts` drives `SyncClient` against a model of the host through 300 seeded random
interleavings of local typing, host changes, and message delivery, and checks that both sides
always end with the same text.

## Typing groups

VS Code creates one undo step per `WorkspaceEdit`. To keep undo useful, `SyncClient` collects
typing for 600 ms after the last keystroke (at most 3 s) and sends it as one edit; formatting,
paste, and line breaks are sent at once. Before save (`onWillSaveTextDocument`), undo, and redo,
the host sends `flush` and waits for `flushed`, so the document always contains everything typed.
The webview also flushes when it loses focus or is hidden.

## Editing features

- `formatting.ts`: syntax-aware toggles for bold, italic, strikethrough, inline code, headings
  1–3, bullet, numbered, and task lists, quotes, code blocks, and insertion of links, tables, and
  horizontal rules. Ambiguous selections (inline formatting across lines, touching markers of
  another kind) are left unchanged.
- `webview/live-preview.ts`: decorations only; the document text never changes.
- `webview/smart-input.ts`: closing brackets and backticks, wrapping selections in emphasis
  markers; list continuation comes from the CodeMirror Markdown keymap.

## Security

Both directions are validated at runtime (`parseWebviewMessage`, `parseHostMessage`): unknown
types, extra keys, negative or fractional numbers, overlapping or unsorted ranges, and oversized
payloads are rejected. The webview runs with a Content Security Policy that allows only the
bundled script and stylesheet (with a nonce), and CodeMirror's injected styles carry the same
nonce.
