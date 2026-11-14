import { insertBracket } from "@codemirror/autocomplete";
import { indentLess, indentMore } from "@codemirror/commands";
import { insertNewlineContinueMarkup, markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { replaceAll, search, SearchQuery, setSearchQuery } from "@codemirror/search";
import {
  EditorSelection,
  EditorState,
  type StateCommand,
  type Transaction,
  type TransactionSpec,
} from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { describe, expect, it } from "vitest";
import { SyncClient } from "../../src/sync-client";
import { autoPair } from "../../src/webview/smart-input";

/*
 * The editor commands behind acceptance tests 57 and 58, run on an EditorState as the webview
 * configures it. Each produces exactly one transaction; the sync client sends a transaction that
 * is not typing as one edit, and the host applies one edit as one VS Code undo step.
 */

function state(doc: string, cursor = doc.length): EditorState {
  return EditorState.create({
    doc,
    selection: EditorSelection.cursor(cursor),
    extensions: [markdown({ base: markdownLanguage, addKeymap: true }), search(), autoPair],
  });
}

/** Runs a state command and returns its transactions. */
function run(command: StateCommand, start: EditorState): Transaction[] {
  const transactions: Transaction[] = [];
  command({
    state: start,
    dispatch: (transaction) => {
      transactions.push(transaction);
    },
  });
  return transactions;
}

/**
 * The edits that the webview sends for each transaction, as `main.ts` classifies them. A fresh
 * client per transaction, so an earlier unacknowledged edit does not hold the next one back.
 */
function sentEdits(transactions: readonly Transaction[]): number[] {
  return transactions.map((transaction) => {
    let sent = 0;
    const client = new SyncClient(
      () => {
        sent++;
      },
      { groupingDelayMs: 600, maxGroupMs: 3000, setTimer: () => 0, clearTimer: () => undefined },
    );
    client.init(1, transaction.startState.doc.toString());
    const typing = transaction.isUserEvent("input.type") || transaction.isUserEvent("delete");
    client.local(transaction.changes, typing);
    client.flushNow();
    return sent;
  });
}

/** Line numbers (1-based) touched by a transaction's changes, in the original document. */
function touchedLines(transaction: Transaction): number[] {
  const lines = new Set<number>();
  transaction.changes.iterChangedRanges((from, to) => {
    const first = transaction.startState.doc.lineAt(from).number;
    const last = transaction.startState.doc.lineAt(to).number;
    for (let line = first; line <= last; line++) {
      lines.add(line);
    }
  });
  return [...lines];
}

describe("find and replace (AT 57)", () => {
  const lines = Array.from({ length: 5000 }, (_, index) =>
    index % 1000 === 999 ? `Line ${String(index)} with target` : `Line ${String(index)}`,
  );
  const doc = `${lines.join("\n")}\n`;

  it("finds matches anywhere in the document, not only in the visible area", () => {
    const cursor = new SearchQuery({ search: "target" }).getCursor(state(doc, 0));
    const found: number[] = [];
    for (let match = cursor.next(); !match.done; match = cursor.next()) {
      found.push(state(doc).doc.lineAt(match.value.from).number);
    }
    expect(found).toEqual([1000, 2000, 3000, 4000, 5000]);
  });

  it("replaces all matches in one transaction, sent as one edit", () => {
    let current = state(doc, 0);
    current = current.update({
      effects: setSearchQuery.of(new SearchQuery({ search: "target", replace: "match" })),
    }).state;
    const transactions: Transaction[] = [];
    const view = {
      get state() {
        return current;
      },
      dispatch(spec: TransactionSpec) {
        const transaction = current.update(spec);
        transactions.push(transaction);
        current = transaction.state;
      },
    };
    expect(replaceAll(view as unknown as EditorView)).toBe(true);
    expect(transactions).toHaveLength(1);
    expect(current.doc.toString()).toBe(doc.replaceAll("target", "match"));
    expect(sentEdits(transactions)).toEqual([1]);
  });
});

describe("list editing and paired markers (AT 58)", () => {
  const doc = "# List\n\n- one\n- two\n\nAfter\n";
  const endOfTwo = doc.indexOf("two") + "two".length;

  it("continues a list on Enter with one edit inside the current item", () => {
    const transactions = run(insertNewlineContinueMarkup, state(doc, endOfTwo));
    expect(transactions).toHaveLength(1);
    const [transaction] = transactions;
    expect(transaction?.state.doc.toString()).toBe("# List\n\n- one\n- two\n- \n\nAfter\n");
    expect(transaction && touchedLines(transaction)).toEqual([4]);
    expect(sentEdits(transactions)).toEqual([1]);
  });

  it("indents and outdents the current item with Tab and Shift+Tab, one edit each", () => {
    const indented = run(indentMore, state(doc, endOfTwo));
    expect(indented).toHaveLength(1);
    const after = indented[0]?.state;
    expect(after?.doc.line(4).text).toMatch(/^\s+- two$/);
    expect(indented[0] && touchedLines(indented[0])).toEqual([4]);

    const outdented = after ? run(indentLess, after) : [];
    expect(outdented).toHaveLength(1);
    expect(outdented[0]?.state.doc.toString()).toBe(doc);
    expect(sentEdits([...indented, ...outdented])).toEqual([1, 1]);
  });

  it("closes a paired marker with one edit at the cursor", () => {
    // After a space: symmetric markers are not paired right after a word character.
    const spaced = "# List\n\n- one\n- two \n\nAfter\n";
    const start = state(spaced, spaced.indexOf("two ") + "two ".length);
    for (const bracket of ["(", "[", "`", '"']) {
      const transaction = insertBracket(start, bracket);
      expect(transaction, bracket).not.toBeNull();
      if (transaction) {
        expect(touchedLines(transaction)).toEqual([4]);
        expect(transaction.state.doc.line(4).text).toMatch(/^- two (\(\)|\[\]|``|"")$/);
      }
    }
  });
});
