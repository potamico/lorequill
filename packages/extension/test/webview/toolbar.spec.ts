import { expect, test } from "@playwright/test";
import { labels, openEditor, sendToEditor } from "./harness";

// The toolbar of a plain Markdown file and of a page in a folder with a profile (#10).

test("offers Check Pages, Commit, and Submit only for a managed page", async ({ page }) => {
  await openEditor(page, "# Title\n\nText\n");
  const toolbar = page.getByRole("toolbar");
  const managed = [labels.checkPages, labels.commit, labels.submit].map((name) =>
    toolbar.getByRole("button", { name, exact: true }),
  );

  // Until the host says otherwise, the file is plain: the editor alone.
  await expect(toolbar.getByRole("button", { name: labels.save, exact: true })).toBeVisible();
  await expect(toolbar.getByRole("button", { name: labels.bold, exact: true })).toBeVisible();
  for (const button of managed) {
    await expect(button).toBeHidden();
  }

  await sendToEditor(page, { type: "context", managed: true });
  for (const button of managed) {
    await expect(button).toBeVisible();
  }

  // The profile was removed or became invalid.
  await sendToEditor(page, { type: "context", managed: false });
  for (const button of managed) {
    await expect(button).toBeHidden();
  }
});
