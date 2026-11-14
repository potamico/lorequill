import { closeBrackets, closeBracketsKeymap } from "@codemirror/autocomplete";
import { EditorSelection, EditorState, type Extension } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";

/** Characters that wrap a non-empty selection instead of replacing it: `*text*`, `_text_`, `~text~`. */
const WRAPPERS = new Set(["*", "_", "~"]);

/**
 * Wraps the selection in an emphasis marker when one is typed over selected text. Without a
 * selection the character is typed normally, so `* item` bullets are not disturbed (§8).
 */
const wrapSelection = EditorView.inputHandler.of((view, _from, _to, text) => {
  if (!WRAPPERS.has(text) || view.state.selection.ranges.every((range) => range.empty)) {
    return false;
  }
  const transaction = view.state.changeByRange((range) =>
    range.empty
      ? {
          changes: { from: range.from, insert: text },
          range: EditorSelection.cursor(range.from + text.length),
        }
      : {
          changes: [
            { from: range.from, insert: text },
            { from: range.to, insert: text },
          ],
          range: EditorSelection.range(range.from + text.length, range.to + text.length),
        },
  );
  view.dispatch(
    view.state.update(transaction, { userEvent: "input.format", scrollIntoView: true }),
  );
  return true;
});

/**
 * Smart input (§8): brackets, double quotes, and backticks are closed automatically (typing the
 * closing character steps over it), and emphasis markers wrap a selection. The apostrophe is not
 * paired because it is common in prose. Each assist is one edit.
 */
export const autoPair: Extension = [
  EditorState.languageData.of(() => [{ closeBrackets: { brackets: ["(", "[", "{", "`", '"'] } }]),
  closeBrackets(),
  keymap.of(closeBracketsKeymap),
  wrapSelection,
];
