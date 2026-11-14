import { expect, test } from "@playwright/test";
import { openEditor } from "./harness";

// Inline Markdown in `Edit` (specification §8), as the author sees it in Chromium.

test("strikethrough with one or two tildes is struck through and its tildes are hidden", async ({
  page,
}) => {
  await openEditor(page, "# Title\n\n~~struck through~~ and ~single tilde~.\n");
  const line = page.locator(".cm-line").nth(2);
  await expect(line.locator(".lq-md-strikethrough")).toHaveText(["struck through", "single tilde"]);
  await expect(line).toHaveText("struck through and single tilde.");
});
