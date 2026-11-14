import { expect, test } from "@playwright/test";
import {
  cell,
  cellInput,
  hostText,
  labels,
  openEditor,
  replaceInHost,
  runCommand,
  writeClipboard,
} from "./harness";

// The editable table grid of `Edit` (specification §8), with real clicks and keys in Chromium.

const page = [
  "# Prices",
  "",
  "Intro",
  "",
  "| Item | Price |",
  "| ---- | ----: |",
  "| Tea  |     3 |",
  "",
  "End",
  "",
].join("\n");

test.beforeEach(async ({ page: target }) => {
  await openEditor(target, page);
});

test("shows the table as a grid and edits a cell in place", async ({ page: target }) => {
  await expect(target.locator(".cm-lq-table table")).toBeVisible();
  await expect(target.getByText("| Item |")).toHaveCount(0);

  await cell(target, 1, 0).click();
  await expect(cellInput(target)).toHaveValue("Tea");
  await target.keyboard.type(" and coffee");

  // The other cells stay rendered while one is edited, and the host has the new text.
  await expect(target.locator("input.cm-lq-cell-input")).toHaveCount(1);
  await expect(cell(target, 1, 1)).toHaveText("3");
  // Typing changes only the cell's text; the table is realigned when the cell is left.
  await expect.poll(() => hostText(target)).toMatch(/\| Tea and coffee +\| +3 \|/);
});

test("shows a cell's Markdown while it is edited and renders it afterwards", async ({
  page: target,
}) => {
  await cell(target, 1, 0).click();
  await target.keyboard.press("Control+A");
  await target.keyboard.type("**Tea**");
  await target.keyboard.press("Tab");

  await expect(cell(target, 1, 0).locator("strong")).toHaveText("Tea");
  await expect.poll(() => hostText(target)).toContain("| **Tea** |");
});

test("escapes a typed pipe", async ({ page: target }) => {
  await cell(target, 1, 0).click();
  await target.keyboard.type(" | milk");
  await target.keyboard.press("Escape");

  await expect.poll(() => hostText(target)).toContain("| Tea \\| milk |");
  await expect(cell(target, 1, 0)).toHaveText("Tea | milk");
});

test("Tab moves through the cells, adds a row at the end, and keeps the source aligned", async ({
  page: target,
}) => {
  await cell(target, 0, 0).click();
  await target.keyboard.press("Tab");
  await expect(cellInput(target)).toHaveValue("Price");
  await target.keyboard.press("Tab");
  await target.keyboard.press("Tab");
  await target.keyboard.press("Tab");
  await target.keyboard.type("Water");
  await target.keyboard.press("Shift+Tab");
  await expect(cellInput(target)).toHaveValue("3");
  await target.keyboard.press("Escape");

  await expect(target.locator(".cm-lq-table tr")).toHaveCount(3);
  await expect
    .poll(() => hostText(target))
    .toContain(
      ["| Item  | Price |", "| ----- | ----: |", "| Tea   |     3 |", "| Water |       |"].join(
        "\n",
      ),
    );
});

test("Enter adds a row and ends the table in an empty last row", async ({ page: target }) => {
  await cell(target, 1, 1).click();
  await target.keyboard.press("Enter");
  await expect(target.locator(".cm-lq-table tr")).toHaveCount(3);
  await target.keyboard.type("Juice");
  await target.keyboard.press("Enter");
  await target.keyboard.press("Enter");

  await expect(target.locator(".cm-lq-table tr")).toHaveCount(3);
  await expect(target.locator(".cm-content")).toBeFocused();
  await target.keyboard.type("After");
  await expect.poll(() => hostText(target)).toContain("| Juice |       |\n\nAfter\n\nEnd");
});

test("arrow keys move between cells and in and out of the table", async ({ page: target }) => {
  await target.getByText("Intro").click();
  await target.keyboard.press("End");
  await target.keyboard.press("ArrowDown");
  await target.keyboard.press("ArrowDown");
  await expect(cellInput(target)).toHaveValue("Item");

  await target.keyboard.press("ArrowDown");
  await expect(cellInput(target)).toHaveValue("Tea");
  await target.keyboard.press("End");
  await target.keyboard.press("ArrowRight");
  await expect(cellInput(target)).toHaveValue("3");
  await target.keyboard.press("Home");
  await target.keyboard.press("ArrowLeft");
  await expect(cellInput(target)).toHaveValue("Tea");

  // Leaving the table puts the cursor on the next line with text, never right below the table.
  await target.keyboard.press("ArrowDown");
  await expect(target.locator(".cm-content")).toBeFocused();
  await target.keyboard.type("Z");
  await expect.poll(() => hostText(target)).toContain("\n\nZEnd\n");
});

test("the table tools act on the cell being edited", async ({ page: target }) => {
  await cell(target, 1, 0).click();
  await target.locator(".lq-button .codicon-table").click();
  const menu = target.getByRole("menu", { name: labels.tableTools });
  await expect(menu).toBeVisible();
  await expect(menu.getByRole("menuitem", { name: labels.tableDeleteRow })).toBeEnabled();
  await menu.getByRole("menuitem", { name: labels.tableInsertColumnRight }).click();

  await expect(menu).toBeHidden();
  await expect(target.locator(".cm-lq-table tr").first().locator("th")).toHaveCount(3);
  await target.keyboard.type("Size");
  await expect.poll(() => hostText(target)).toMatch(/\| Tea +\| Size +\| +3 \|/);
});

test("the table tools menu works with the keyboard", async ({ page: target }) => {
  await cell(target, 0, 0).click();
  await target.locator(".lq-button .codicon-table").click();
  const menu = target.getByRole("menu", { name: labels.tableTools });
  // The header row cannot be deleted, so its item is disabled and skipped.
  await expect(menu.getByRole("menuitem", { name: labels.tableDeleteRow })).toBeDisabled();
  await target.keyboard.press("ArrowDown");
  await target.keyboard.press("Escape");
  await expect(menu).toBeHidden();
});

test("a change from outside, such as undo, updates the cell being edited", async ({
  page: target,
}) => {
  await cell(target, 1, 0).click();
  await target.keyboard.type("s");
  await expect.poll(() => hostText(target)).toMatch(/\| Teas +\|/);

  await replaceInHost(target, "Teas", "Tea");
  await expect(cellInput(target)).toHaveValue("Tea");
  await expect(cellInput(target)).toBeFocused();
});

test("pasting into a cell keeps it on one line", async ({ page: target, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await cell(target, 1, 0).click();
  await writeClipboard(target, "green\ntea");
  await target.keyboard.press("Control+A");
  await target.keyboard.press("Control+V");

  await expect.poll(() => hostText(target)).toMatch(/\| green ?tea +\|/);
  expect((await hostText(target)).split("\n")).toHaveLength(page.split("\n").length);
});

test("a selection across the table shows its source", async ({ page: target }) => {
  await target.getByText("Intro").click();
  await target.keyboard.press("Control+A");
  await expect(target.getByText("| Item | Price |")).toBeVisible();
});

test("each cell tells VS Code's context menu which table tools apply", async ({ page: target }) => {
  const context = async (row: number, column: number): Promise<unknown> =>
    JSON.parse((await cell(target, row, column).getAttribute("data-vscode-context")) ?? "null");
  expect(await context(0, 0)).toEqual({
    webviewSection: "tableCell",
    tableHeader: true,
    tableFirstRow: false,
    tableLastRow: false,
    tableFirstColumn: true,
    tableLastColumn: false,
    tableSingleColumn: false,
  });
  expect(await context(1, 1)).toMatchObject({
    tableHeader: false,
    tableFirstRow: true,
    tableLastRow: true,
    tableLastColumn: true,
  });

  // The marks follow the table's shape when rows are added.
  await cell(target, 1, 1).click();
  await target.keyboard.press("Enter");
  expect(await context(1, 1)).toMatchObject({ tableLastRow: false });
  expect(await context(2, 0)).toMatchObject({ tableLastRow: true, tableFirstRow: false });
});

test("a right click edits the clicked cell, so context menu commands act on it", async ({
  page: target,
}) => {
  await cell(target, 1, 1).click();
  await target.keyboard.press("Enter");
  await target.keyboard.type("Water");
  await cell(target, 1, 0).click({ button: "right" });
  await expect(cellInput(target)).toHaveValue("Tea");

  await runCommand(target, "tableMoveRowDown");
  await expect.poll(() => hostText(target)).toMatch(/\| Water +\| +\|\n\| Tea +\| +3 \|/);
  await expect(cellInput(target)).toHaveValue("Tea");

  await cell(target, 0, 1).click({ button: "right" });
  await runCommand(target, "tableMoveColumnLeft");
  await expect.poll(() => hostText(target)).toContain("| Price | Item  |");
});

test("Delete table removes it and returns to the text", async ({ page: target }) => {
  await cell(target, 1, 0).click({ button: "right" });
  await runCommand(target, "tableDelete");

  await expect(target.locator(".cm-lq-table")).toHaveCount(0);
  await expect(target.locator(".cm-content")).toBeFocused();
  await expect.poll(() => hostText(target)).toBe("# Prices\n\nIntro\n\nEnd\n");
});

test("the toolbar menu offers moving rows and columns and deleting the table", async ({
  page: target,
}) => {
  await cell(target, 1, 0).click();
  await target.locator(".lq-button .codicon-table").click();
  const menu = target.getByRole("menu", { name: labels.tableTools });
  await expect(menu.getByRole("menuitem", { name: labels.tableMoveRowUp })).toBeDisabled();
  await expect(menu.getByRole("menuitem", { name: labels.tableMoveColumnRight })).toBeEnabled();
  await menu.getByRole("menuitem", { name: labels.tableMoveColumnRight }).click();
  await expect.poll(() => hostText(target)).toMatch(/\| Price \| Item \|/);
});
