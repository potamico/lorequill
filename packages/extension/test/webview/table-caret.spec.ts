import { expect, test, type Page } from "@playwright/test";
import { cell, cellInput, hostText, openEditor } from "./harness";

// A click on a grid cell places the caret where the cell was clicked (#11).

const page = [
  "| Drink | Note |",
  "| ----- | ---- |",
  "| Tea and coffee | **bold** text |",
  "",
].join("\n");

/** The DOM parts the page function uses; the extension's sources have no DOM types. */
interface TextNode {
  readonly textContent: string | null;
}
interface CellElement {
  readonly ownerDocument: {
    createTreeWalker(root: CellElement, whatToShow: number): { nextNode(): TextNode | null };
    createRange(): {
      setStart(node: TextNode, offset: number): void;
      setEnd(node: TextNode, offset: number): void;
      getBoundingClientRect(): { left: number; top: number; height: number };
    };
  };
}

/**
 * Clicks just before the character at `index` of the rendered text `text` in a cell, at the left
 * edge of that character.
 */
async function clickBefore(
  target: Page,
  row: number,
  column: number,
  text: string,
  index: number,
): Promise<void> {
  const point = await cell(target, row, column).evaluate(
    (node: unknown, [wanted, at]) => {
      const element = node as CellElement;
      const walker = element.ownerDocument.createTreeWalker(element, 4 /* SHOW_TEXT */);
      let offset = at;
      for (let text = walker.nextNode(); text; text = walker.nextNode()) {
        const length = text.textContent?.length ?? 0;
        if (offset < length) {
          const range = element.ownerDocument.createRange();
          range.setStart(text, offset);
          range.setEnd(text, offset + 1);
          const box = range.getBoundingClientRect();
          return { x: box.left + 1, y: box.top + box.height / 2 };
        }
        offset -= length;
      }
      throw new Error(`No character ${String(at)} in "${wanted}"`);
    },
    [text, index] as const,
  );
  await target.mouse.click(point.x, point.y);
}

test.beforeEach(async ({ page: target }) => {
  await openEditor(target, page);
});

test("a click in plain text puts the caret at the clicked character", async ({ page: target }) => {
  // Before the "a" of "and".
  await clickBefore(target, 1, 0, "Tea and coffee", 4);
  await expect(cellInput(target)).toHaveValue("Tea and coffee");
  await target.keyboard.type("X");
  await expect.poll(() => hostText(target)).toContain("| Tea Xand coffee");
});

test("a click in formatted text maps to the Markdown source", async ({ page: target }) => {
  // Before "text" in the rendered "bold text"; in the source after "**bold** ".
  await clickBefore(target, 1, 1, "bold text", 5);
  await expect(cellInput(target)).toHaveValue("**bold** text");
  await target.keyboard.type("X");
  await expect.poll(() => hostText(target)).toContain("**bold** Xtext");
});

test("a click on the padding of a cell puts the caret at the end", async ({ page: target }) => {
  const box = await cell(target, 1, 0).boundingBox();
  if (!box) {
    throw new Error("The cell has no box.");
  }
  await target.mouse.click(box.x + box.width - 3, box.y + box.height / 2);
  await target.keyboard.type("!");
  await expect.poll(() => hostText(target)).toContain("| Tea and coffee! ");
});
