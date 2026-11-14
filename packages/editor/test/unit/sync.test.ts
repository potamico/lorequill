import { ChangeSet, Text } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import {
  EDITOR_LABEL_KEYS,
  fromSequentialChanges,
  parseHostMessage,
  parseWebviewMessage,
  SyncClient,
  type EditorLabels,
  type HostMessage,
  type TextChange,
  type WebviewMessage,
} from "../../src";

/** Applies protocol changes (all relative to the same document) to a string. */
function applySimultaneous(text: string, changes: readonly TextChange[]): string {
  const doc = Text.of(text.split("\n"));
  const offset = (line: number, character: number): number => doc.line(line + 1).from + character;
  const specs = changes.map((change) => ({
    from: offset(change.from.line, change.from.character),
    to: offset(change.to.line, change.to.character),
    insert: change.text,
  }));
  return ChangeSet.of(specs, doc.length).apply(doc).toString();
}

/**
 * A model of the extension host: the authoritative document with a version, processing webview
 * messages in order, as the custom editor provider does.
 */
class HostModel {
  text: string;
  version = 1;
  readonly outbox: HostMessage[] = [];

  constructor(text: string) {
    this.text = text;
  }

  receive(message: WebviewMessage): void {
    if (message.type === "ready") {
      this.outbox.push({
        type: "init",
        version: this.version,
        text: this.text,
        settings,
        labels,
      });
      return;
    }
    if (message.type !== "edit") {
      return;
    }
    if (message.baseVersion !== this.version) {
      this.outbox.push({ type: "reject", id: message.id });
      return;
    }
    this.text = applySimultaneous(this.text, message.changes);
    this.version++;
    this.outbox.push({ type: "ack", id: message.id, version: this.version });
  }

  /** A change from elsewhere: undo, another editor, the properties panel. */
  external(change: TextChange): void {
    const result = fromSequentialChanges([change], Text.of(this.text.split("\n")));
    if (!result) {
      return;
    }
    this.text = result.doc.toString();
    this.version++;
    this.outbox.push({ type: "update", version: this.version, changes: [change] });
  }
}

const settings = {
  fontFamily: "monospace",
  fontSize: 14,
  tabSize: 4,
  wordWrap: true,
  maxTextWidth: 800,
};
const labels = Object.fromEntries(EDITOR_LABEL_KEYS.map((key) => [key, key])) as EditorLabels;

/** A model of the webview: a document view driven by a SyncClient. */
class WebviewModel {
  view = Text.empty;
  readonly outbox: WebviewMessage[] = [];
  readonly client = new SyncClient((message) => this.outbox.push(message));

  receive(message: HostMessage): void {
    let instruction;
    switch (message.type) {
      case "init":
        instruction = this.client.init(message.version, message.text);
        break;
      case "update":
        instruction = this.client.update(message.version, message.changes);
        break;
      case "ack":
        instruction = this.client.ack(message.id, message.version);
        break;
      case "reject":
        instruction = this.client.reject(message.id);
        break;
      default:
        return;
    }
    if (instruction.kind === "reset") {
      this.view = Text.of(instruction.text.split("\n"));
    } else if (instruction.kind === "apply") {
      this.view = instruction.changes.apply(this.view);
    }
  }

  type(changes: ChangeSet): void {
    this.view = changes.apply(this.view);
    this.client.local(changes);
  }
}

function random(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function randomEdit(doc: Text, next: () => number): { from: number; to: number; insert: string } {
  const from = Math.floor(next() * (doc.length + 1));
  const to = Math.min(doc.length, from + Math.floor(next() * 4));
  const pieces = ["a", "b", "ü", "\n", "xy", "", "🎉"];
  const insert = pieces[Math.floor(next() * pieces.length)] ?? "";
  return { from, to, insert };
}

function positionOf(doc: Text, offset: number): { line: number; character: number } {
  const line = doc.lineAt(offset);
  return { line: line.number - 1, character: offset - line.from };
}

function deliverToHost(host: HostModel, webview: WebviewModel): void {
  const message = webview.outbox.shift();
  if (!message) {
    throw new Error("no message for the host");
  }
  host.receive(message);
}

function deliverToWebview(host: HostModel, webview: WebviewModel): void {
  const message = host.outbox.shift();
  if (!message) {
    throw new Error("no message for the webview");
  }
  webview.receive(message);
}

describe("SyncClient with a host model", () => {
  it("applies local edits and acknowledges them", () => {
    const host = new HostModel("Hello");
    const webview = new WebviewModel();
    webview.client.resync();
    deliverToHost(host, webview);
    deliverToWebview(host, webview);
    webview.type(ChangeSet.of({ from: 5, insert: " world" }, 5));
    deliverToHost(host, webview);
    deliverToWebview(host, webview);
    expect(host.text).toBe("Hello world");
    expect(webview.view.toString()).toBe("Hello world");
    expect(host.version).toBe(2);
  });

  it("never lets a stale edit overwrite newer host text", () => {
    const host = new HostModel("abc");
    const webview = new WebviewModel();
    webview.client.resync();
    deliverToHost(host, webview);
    deliverToWebview(host, webview);

    // The user types while an undo happens in the host; the messages cross.
    webview.type(ChangeSet.of({ from: 3, insert: "d" }, 3));
    host.external({ from: { line: 0, character: 0 }, to: { line: 0, character: 1 }, text: "X" });
    deliverToHost(host, webview);
    expect(host.text).toBe("Xbc");
    expect(host.outbox.map(({ type }) => type)).toEqual(["update", "reject"]);

    // The webview rebases its edit over the host change and sends it again.
    deliverToWebview(host, webview);
    deliverToWebview(host, webview);
    deliverToHost(host, webview);
    deliverToWebview(host, webview);
    expect(host.text).toBe("Xbcd");
    expect(webview.view.toString()).toBe("Xbcd");
  });

  for (let seed = 1; seed <= 300; seed++) {
    it(`converges for random interleavings (seed ${String(seed)})`, () => {
      const next = random(seed);
      const host = new HostModel("Line one\nLine two\n");
      const webview = new WebviewModel();
      webview.client.resync();

      for (let step = 0; step < 80; step++) {
        const action = next();
        if (action < 0.3 && webview.client.initialized) {
          const edit = randomEdit(webview.view, next);
          webview.type(ChangeSet.of(edit, webview.view.length));
        } else if (action < 0.45) {
          const doc = Text.of(host.text.split("\n"));
          const edit = randomEdit(doc, next);
          host.external({
            from: positionOf(doc, edit.from),
            to: positionOf(doc, edit.to),
            text: edit.insert,
          });
        } else if (action < 0.75) {
          const message = webview.outbox.shift();
          if (message) {
            host.receive(message);
          }
        } else {
          const message = host.outbox.shift();
          if (message) {
            webview.receive(message);
          }
        }
      }
      // Deliver everything that is still in transit.
      while (webview.outbox.length > 0 || host.outbox.length > 0) {
        const toHost = webview.outbox.shift();
        if (toHost) {
          host.receive(toHost);
        }
        const toWebview = host.outbox.shift();
        if (toWebview) {
          webview.receive(toWebview);
        }
      }
      expect(webview.view.toString()).toBe(host.text);
    });
  }
});

describe("message validation", () => {
  it("accepts well-formed webview messages", () => {
    expect(parseWebviewMessage({ type: "ready" })).toEqual({ type: "ready" });
    const edit = {
      type: "edit",
      id: 1,
      baseVersion: 3,
      changes: [{ from: { line: 0, character: 0 }, to: { line: 0, character: 1 }, text: "x" }],
    };
    expect(parseWebviewMessage(edit)).toEqual(edit);
  });

  it("accepts link targets on one line within the size limit", () => {
    expect(parseWebviewMessage({ type: "openLink", target: "setup.md#install" })).toEqual({
      type: "openLink",
      target: "setup.md#install",
    });
    expect(parseWebviewMessage({ type: "openLink", target: "" })).toBeUndefined();
    expect(parseWebviewMessage({ type: "openLink", target: "a\nb" })).toBeUndefined();
    expect(parseWebviewMessage({ type: "openLink", target: "x".repeat(5000) })).toBeUndefined();
    expect(parseWebviewMessage({ type: "openLink", target: 1 })).toBeUndefined();
  });

  it("rejects malformed, extended, overlapping, or hostile webview messages", () => {
    const change = { from: { line: 0, character: 2 }, to: { line: 0, character: 4 }, text: "x" };
    for (const message of [
      null,
      "ready",
      { type: "ready", extra: true },
      { type: "save" },
      { type: "edit", id: 1, baseVersion: -1, changes: [] },
      { type: "edit", id: 1.5, baseVersion: 1, changes: [] },
      {
        type: "edit",
        id: 1,
        baseVersion: 1,
        changes: [{ ...change, from: { line: 0, character: 5 } }],
      },
      { type: "edit", id: 1, baseVersion: 1, changes: [change, change] },
      { type: "edit", id: 1, baseVersion: 1, changes: [{ ...change, text: 42 }] },
      { type: "edit", id: 1, baseVersion: 1, changes: [{ ...change, uri: "file:///etc/passwd" }] },
      { type: "edit", id: 1, baseVersion: 1, changes: "x" },
    ]) {
      expect(parseWebviewMessage(message), JSON.stringify(message)).toBeUndefined();
    }
  });

  it("validates host messages", () => {
    expect(parseHostMessage({ type: "ack", id: 1, version: 2 })).toEqual({
      type: "ack",
      id: 1,
      version: 2,
    });
    expect(
      parseHostMessage({ type: "init", version: 1, text: "x", settings, labels }),
    ).toBeDefined();
    expect(
      parseHostMessage({ type: "init", version: 1, text: "x", settings: {}, labels }),
    ).toBeUndefined();
    expect(
      parseHostMessage({ type: "init", version: 1, text: "x", settings, labels: { toolbar: 1 } }),
    ).toBeUndefined();
    expect(parseHostMessage({ type: "command", command: "rm -rf" })).toBeUndefined();
    expect(
      parseHostMessage({ type: "settings", settings: { ...settings, maxTextWidth: 0 } }),
    ).toEqual({ type: "settings", settings: { ...settings, maxTextWidth: 0 } });
    expect(
      parseHostMessage({ type: "settings", settings: { ...settings, maxTextWidth: -1 } }),
    ).toBeUndefined();
    expect(
      parseHostMessage({ type: "settings", settings: { ...settings, maxTextWidth: 20_000 } }),
    ).toBeUndefined();
    expect(parseHostMessage({ type: "reveal", line: 3 })).toEqual({ type: "reveal", line: 3 });
    expect(parseHostMessage({ type: "reveal", line: -1 })).toBeUndefined();
    expect(parseHostMessage({ type: "reveal", line: 1.5 })).toBeUndefined();
    expect(parseHostMessage({ type: "reveal", line: 1, extra: true })).toBeUndefined();
  });
});

describe("fromSequentialChanges", () => {
  it("applies changes one after another and rejects ranges outside the document", () => {
    const doc = Text.of(["abc", "def"]);
    const result = fromSequentialChanges(
      [
        { from: { line: 1, character: 0 }, to: { line: 1, character: 3 }, text: "X" },
        { from: { line: 0, character: 0 }, to: { line: 0, character: 0 }, text: "1" },
      ],
      doc,
    );
    expect(result?.doc.toString()).toBe("1abc\nX");
    expect(
      fromSequentialChanges(
        [{ from: { line: 5, character: 0 }, to: { line: 5, character: 0 }, text: "" }],
        doc,
      ),
    ).toBeUndefined();
  });
});

describe("typing groups", () => {
  function setup(): {
    client: SyncClient;
    sent: WebviewMessage[];
    timers: { callback: () => void; ms: number }[];
    clock: { now: number };
  } {
    const sent: WebviewMessage[] = [];
    const timers: { callback: () => void; ms: number }[] = [];
    const clock = { now: 0 };
    const client = new SyncClient((message) => sent.push(message), {
      groupingDelayMs: 400,
      maxGroupMs: 1000,
      setTimer: (callback, ms) => {
        const timer = { callback, ms };
        timers.push(timer);
        return timer;
      },
      clearTimer: (handle) => {
        timers.splice(timers.indexOf(handle as (typeof timers)[number]), 1);
      },
      now: () => clock.now,
    });
    client.init(1, "");
    return { client, sent, timers, clock };
  }

  it("sends typing as one edit after a pause", () => {
    const { client, sent, timers } = setup();
    client.local(ChangeSet.of({ from: 0, insert: "a" }, 0), true);
    client.local(ChangeSet.of({ from: 1, insert: "b" }, 1), true);
    expect(sent).toEqual([]);
    expect(timers).toHaveLength(1);
    timers[0]?.callback();
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ type: "edit", changes: [{ text: "ab" }] });
  });

  it("limits a group while typing continues", () => {
    const { client, timers, clock } = setup();
    client.local(ChangeSet.of({ from: 0, insert: "a" }, 0), true);
    clock.now = 900;
    client.local(ChangeSet.of({ from: 1, insert: "b" }, 1), true);
    expect(timers.at(-1)?.ms).toBe(100);
  });

  it("sends non-typing changes and flush requests at once", () => {
    const { client, sent } = setup();
    client.local(ChangeSet.of({ from: 0, insert: "a" }, 0), true);
    client.local(ChangeSet.of({ from: 1, insert: "**" }, 1));
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ changes: [{ text: "a**" }] });
    expect(client.pending).toBe(true);
    client.ack(1, 2);
    expect(client.pending).toBe(false);
    client.local(ChangeSet.of({ from: 3, insert: "c" }, 3), true);
    client.flushNow();
    expect(sent).toHaveLength(2);
  });
});
