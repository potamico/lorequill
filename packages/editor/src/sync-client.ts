import { ChangeSet, Text } from "@codemirror/state";
import type { Position, TextChange, WebviewMessage } from "./protocol";

/** Converts a 0-based line/character position into an offset; `undefined` if out of range. */
export function offsetOf(doc: Text, position: Position): number | undefined {
  if (position.line >= doc.lines) {
    return undefined;
  }
  const line = doc.line(position.line + 1);
  return position.character <= line.length ? line.from + position.character : undefined;
}

export function positionOf(doc: Text, offset: number): Position {
  const line = doc.lineAt(offset);
  return { line: line.number - 1, character: offset - line.from };
}

/** The ranges of a change set relative to `doc`, as protocol changes (sorted, disjoint). */
export function toTextChanges(changes: ChangeSet, doc: Text): TextChange[] {
  const result: TextChange[] = [];
  changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
    result.push({
      from: positionOf(doc, fromA),
      to: positionOf(doc, toA),
      text: inserted.toString(),
    });
  });
  return result;
}

/**
 * Builds one change set from protocol changes applied one after another (each relative to the
 * result of the previous ones), as VS Code reports document changes. `undefined` if a range does
 * not exist in the document.
 */
export function fromSequentialChanges(
  changes: readonly TextChange[],
  doc: Text,
): { changes: ChangeSet; doc: Text } | undefined {
  let combined = ChangeSet.empty(doc.length);
  let current = doc;
  for (const change of changes) {
    const from = offsetOf(current, change.from);
    const to = offsetOf(current, change.to);
    if (from === undefined || to === undefined || from > to) {
      return undefined;
    }
    const step = ChangeSet.of({ from, to, insert: change.text }, current.length);
    combined = combined.compose(step);
    current = step.apply(current);
  }
  return { changes: combined, doc: current };
}

/** What the editor view must do after a host message. */
export type ViewInstruction =
  | { readonly kind: "none" }
  /** Apply these changes to the view (they are relative to the view's current document). */
  | { readonly kind: "apply"; readonly changes: ChangeSet }
  /** Replace the whole view document. */
  | { readonly kind: "reset"; readonly text: string };

/**
 * The webview side of document synchronization (specification §7).
 *
 * The host's `TextDocument` is authoritative. The client keeps the last document both sides agree
 * on (`confirmed`, at host version `version`), at most one edit in flight, and local changes made
 * since then (`buffer`). An edit carries the version it is based on; the host applies it only if
 * that version is still current, so a stale edit can never overwrite newer text. When the host
 * reports other changes while an edit is in flight, that edit is known to be rejected; the client
 * rebases its local changes over the host changes and sends them again. No acknowledged edit
 * exists only here: local changes are always on their way to the host or rebased and resent.
 */
export interface SyncClientOptions {
  /**
   * Typing is collected for this long after the last keystroke before it is sent, so that one
   * VS Code undo step covers a phrase instead of a single character. 0 sends at once.
   */
  readonly groupingDelayMs?: number;
  /** A group is sent at the latest after this long, even while typing continues. */
  readonly maxGroupMs?: number;
  readonly setTimer?: (callback: () => void, ms: number) => unknown;
  readonly clearTimer?: (handle: unknown) => void;
  readonly now?: () => number;
}

export class SyncClient {
  private confirmed = Text.empty;
  private version = -1;
  private inflight: { readonly id: number; readonly changes: ChangeSet } | undefined;
  private buffer: ChangeSet | undefined;
  private nextId = 1;
  private timer: unknown;
  private groupStart: number | undefined;
  private readonly groupingDelayMs: number;
  private readonly maxGroupMs: number;
  private readonly setTimer: (callback: () => void, ms: number) => unknown;
  private readonly clearTimer: (handle: unknown) => void;
  private readonly now: () => number;

  constructor(
    private readonly send: (message: WebviewMessage) => void,
    options: SyncClientOptions = {},
  ) {
    this.groupingDelayMs = options.groupingDelayMs ?? 0;
    this.maxGroupMs = options.maxGroupMs ?? 2000;
    this.setTimer = options.setTimer ?? ((callback, ms) => setTimeout(callback, ms));
    this.clearTimer =
      options.clearTimer ??
      ((handle) => {
        clearTimeout(handle as ReturnType<typeof setTimeout>);
      });
    this.now = options.now ?? (() => Date.now());
  }

  /** Whether local changes are waiting to be sent or acknowledged. */
  get pending(): boolean {
    return this.inflight !== undefined || this.buffer !== undefined;
  }

  /** Whether the client has received the document. */
  get initialized(): boolean {
    return this.version >= 0;
  }

  /** Resets to a complete document from the host. */
  init(version: number, text: string): ViewInstruction {
    this.confirmed = Text.of(text.split(/\r\n|\r|\n/));
    this.version = version;
    this.inflight = undefined;
    this.buffer = undefined;
    return { kind: "reset", text: this.confirmed.toString() };
  }

  /**
   * Records a change the user made in the view. `typing` changes (single keystrokes) are grouped;
   * everything else (formatting, paste, line breaks) is sent at once, together with the group.
   */
  local(changes: ChangeSet, typing = false): void {
    if (!this.initialized || changes.empty) {
      return;
    }
    this.buffer = this.buffer ? this.buffer.compose(changes) : changes;
    if (!typing || this.groupingDelayMs <= 0) {
      this.flushNow();
      return;
    }
    const now = this.now();
    this.groupStart ??= now;
    this.cancelTimer();
    const wait = Math.max(
      0,
      Math.min(this.groupingDelayMs, this.groupStart + this.maxGroupMs - now),
    );
    this.timer = this.setTimer(() => {
      this.timer = undefined;
      this.flushNow();
    }, wait);
  }

  /** Sends collected changes now, for example before save, undo, or when the editor loses focus. */
  flushNow(): void {
    this.cancelTimer();
    this.groupStart = undefined;
    this.flush();
  }

  private cancelTimer(): void {
    if (this.timer !== undefined) {
      this.clearTimer(this.timer);
      this.timer = undefined;
    }
  }

  /** The host applied an edit. */
  ack(id: number, version: number): ViewInstruction {
    if (this.inflight?.id !== id) {
      return { kind: "none" };
    }
    this.confirmed = this.inflight.changes.apply(this.confirmed);
    this.version = version;
    this.inflight = undefined;
    if (this.timer === undefined) {
      this.flush();
    }
    return { kind: "none" };
  }

  /** The host rejected an edit. A rejection of the current edit means the documents diverged. */
  reject(id: number): ViewInstruction {
    if (this.inflight?.id === id) {
      this.resync();
    }
    return { kind: "none" };
  }

  /** The host document changed for another reason. */
  update(version: number, changes: readonly TextChange[]): ViewInstruction {
    if (!this.initialized) {
      return { kind: "none" };
    }
    const remote = fromSequentialChanges(changes, this.confirmed);
    if (!remote) {
      this.resync();
      return { kind: "none" };
    }
    // Local changes on top of `confirmed`: the edit in flight (which the host will reject, because
    // it is based on the previous version) followed by the buffer.
    const local = this.inflight
      ? this.buffer
        ? this.inflight.changes.compose(this.buffer)
        : this.inflight.changes
      : this.buffer;
    this.confirmed = remote.doc;
    this.version = version;
    this.inflight = undefined;
    if (!local) {
      this.buffer = undefined;
      return { kind: "apply", changes: remote.changes };
    }
    // Host changes as seen after the local ones, and local changes rebased onto the host's.
    const forView = remote.changes.map(local, true);
    this.buffer = local.map(remote.changes);
    if (this.timer === undefined) {
      this.flush();
    }
    return { kind: "apply", changes: forView };
  }

  /** Asks the host for the complete document. */
  resync(): void {
    this.cancelTimer();
    this.groupStart = undefined;
    this.version = -1;
    this.inflight = undefined;
    this.buffer = undefined;
    this.send({ type: "ready" });
  }

  private flush(): void {
    if (this.inflight || !this.buffer || this.buffer.empty) {
      return;
    }
    const changes = this.buffer;
    this.buffer = undefined;
    this.inflight = { id: this.nextId++, changes };
    this.send({
      type: "edit",
      id: this.inflight.id,
      baseVersion: this.version,
      changes: toTextChanges(changes, this.confirmed),
    });
  }
}
