import * as assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import * as path from "node:path";
import * as vscode from "vscode";
import { profileYaml } from "../../workspaces";
import {
  activateExtension,
  findNode,
  outline,
  waitFor,
  type InternalApi,
  type TreeSnapshot,
  waitForChange,
} from "../support";

function folderPath(name: string): string {
  const folder = vscode.workspace.workspaceFolders?.find((candidate) => candidate.name === name);
  assert.ok(folder, `workspace folder ${name} is open`);
  return folder.uri.fsPath;
}

suite("Multi-root workspace with independent profiles", () => {
  let api: InternalApi;

  suiteSetup(async () => {
    api = await activateExtension();
    await waitFor(
      "all four folders",
      () => api.pagesTree().length,
      (count) => count === 4,
    );
    await waitFor(
      "every folder to finish loading",
      () => api.pagesTree().map((node) => node.children.length),
      (counts) => counts.every((count) => count > 0),
    );
  });

  test("shows one node per workspace folder, in workspace order", () => {
    assert.deepEqual(
      api.pagesTree().map((node) => node.label),
      ["alpha", "beta", "gamma", "delta"],
    );
  });

  test("shows the pages of a folder with a valid profile", () => {
    const alpha = findNode(api.pagesTree(), "alpha");
    assert.deepEqual(outline(alpha?.children ?? []), ["One [one.md]", "Two [two.md]"]);
  });

  test("uses the display language for messages, not the profile locale", () => {
    // beta has a de-CH profile; the test instance runs with an English display language.
    const beta = findNode(api.pagesTree(), "beta");
    assert.match(beta?.children[0]?.label ?? "", /No pages found/);
  });

  test("shows the problem of an invalid profile only in its own folder", () => {
    const gamma = findNode(api.pagesTree(), "gamma");
    assert.equal(gamma?.children.length, 1);
    assert.match(gamma.children[0]?.label ?? "", /The profile is invalid\./);
    assert.match(gamma.children[0]?.label ?? "", /"bogus"/);
    // The other folders are not affected.
    assert.equal(findNode(api.pagesTree(), "alpha")?.children.length, 2);
  });

  test("reports a folder without a profile and does not list its files", () => {
    const delta = findNode(api.pagesTree(), "delta");
    assert.equal(delta?.children.length, 1);
    assert.match(delta.children[0]?.label ?? "", /No profile found/);
    assert.equal(findNode(api.pagesTree(), "Four"), undefined);
  });

  test("never mixes pages of different folders", () => {
    const tree = api.pagesTree();
    for (const node of tree) {
      const root = folderPath(node.label);
      const resources: string[] = [];
      const collect = (nodes: readonly TreeSnapshot[]): void => {
        for (const child of nodes) {
          if (child.resource) {
            resources.push(child.resource);
          }
          collect(child.children);
        }
      };
      collect(node.children);
      for (const resource of resources) {
        assert.ok(resource.startsWith(root + path.sep), `${resource} belongs to ${node.label}`);
      }
    }
  });

  test("refreshes only the folder whose profile changed", async () => {
    const alphaBefore = JSON.stringify(findNode(api.pagesTree(), "alpha"));
    await waitForChange(
      () =>
        writeFile(
          path.join(folderPath("gamma"), ".lorequill", "config.yaml"),
          profileYaml({ locale: "en" }),
        ),
      "gamma to become valid",
      () => outline(findNode(api.pagesTree(), "gamma")?.children ?? []),
      (lines) => lines.length === 1 && lines[0] === "Three [three.md]",
    );
    assert.equal(JSON.stringify(findNode(api.pagesTree(), "alpha")), alphaBefore);
  });
});
