import * as assert from "node:assert/strict";
import * as vscode from "vscode";
import { findExtension } from "../support";

suite("Extension activation", () => {
  test("is discovered by the Extension Development Host", () => {
    assert.equal((findExtension().packageJSON as { name: string }).name, "vscode-lorequill");
  });

  test("activates and registers its commands", async () => {
    const extension = findExtension();
    await extension.activate();
    assert.equal(extension.isActive, true);

    const commands = await vscode.commands.getCommands(true);
    for (const command of [
      "lorequill.showVersion",
      "lorequill.refreshPages",
      "lorequill.filterPages",
      "lorequill.clearPageFilter",
      "lorequill.openProfile",
    ]) {
      assert.ok(commands.includes(command), `${command} is registered`);
    }
  });

  test("shows the Pages view in the Lorequill view container", async () => {
    await findExtension().activate();
    const commands = await vscode.commands.getCommands(true);
    assert.ok(commands.includes("workbench.view.extension.lorequill"), "container is registered");
    // Focusing the view fails if the view is not contributed to a registered container.
    await vscode.commands.executeCommand("workbench.view.extension.lorequill");
    await vscode.commands.executeCommand("lorequill.pages.focus");
  });

  test("runs in a trusted workspace in this scenario", () => {
    assert.equal(vscode.workspace.isTrusted, true);
  });
});
