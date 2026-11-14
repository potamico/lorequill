import * as assert from "node:assert/strict";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
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

const EXPECTED_TREE = [
  "guides",
  "  Installation [setup.md]",
  "no-title.md",
  "Welcome Page [welcome.md]",
];

function workspaceRoot(): string {
  const [folder] = vscode.workspace.workspaceFolders ?? [];
  assert.ok(folder, "a workspace folder is open");
  return folder.uri.fsPath;
}

suite("Pages tree (trusted workspace, one folder)", () => {
  let api: InternalApi;
  const tree = (): readonly TreeSnapshot[] => api.pagesTree();
  const profilePath = (): string => path.join(workspaceRoot(), ".lorequill", "config.yaml");

  suiteSetup(async () => {
    api = await activateExtension();
    await waitFor(
      "the initial page list",
      () => outline(tree()),
      (lines) => lines.length > 0,
    );
  });

  teardown(async () => {
    // Restore the files the tests change, then wait until the tree is back to its start state.
    // The profile is rewritten only when a test changed it, and atomically, so the extension
    // never reads a half-written file.
    const profile = profileYaml({ locale: "en", exclude: '"**/index.md", "drafts/**"' });
    const current = await readFile(profilePath(), "utf8").catch(() => undefined);
    if (current !== profile) {
      const temporary = `${profilePath()}.tmp`;
      await writeFile(temporary, profile);
      await rename(temporary, profilePath());
    }
    await rm(path.join(workspaceRoot(), "docs", "added.md"), { force: true });
    api.setPageFilter("");
    await waitFor(
      "the initial tree",
      () => outline(tree()),
      (lines) => sameLines(lines, EXPECTED_TREE),
    );
  });

  test("reads the profile of the folder", () => {
    assert.equal(api.loadedFolderCount(), 1);
  });

  test("shows included pages with title labels and the file name as description", () => {
    assert.deepEqual(outline(tree()), EXPECTED_TREE);
  });

  test("uses front matter title, then first heading, then file name", () => {
    const labels = new Map<string, string>();
    const collect = (nodes: readonly TreeSnapshot[]): void => {
      for (const node of nodes) {
        if (node.resource) {
          labels.set(path.basename(node.resource), node.label);
        }
        collect(node.children);
      }
    };
    collect(tree());
    assert.equal(labels.get("welcome.md"), "Welcome Page");
    assert.equal(labels.get("setup.md"), "Installation");
    assert.equal(labels.get("no-title.md"), "no-title.md");
  });

  test("hides excluded pages and excluded directories", () => {
    const lines = outline(tree()).join("\n");
    assert.ok(!lines.includes("Home"), "docs/index.md is excluded");
    assert.ok(!lines.includes("Guides"), "docs/guides/index.md is excluded");
    assert.ok(!lines.includes("Idea"), "docs/drafts is excluded");
    assert.ok(!lines.includes("drafts"));
  });

  test("opens a page in the Lorequill page editor", async () => {
    const page = findNode(tree(), "Welcome Page");
    assert.equal(page?.command, "vscode.openWith");
    assert.ok(page.resource);
    await vscode.commands.executeCommand(
      "vscode.openWith",
      vscode.Uri.file(page.resource),
      "lorequill.pageEditor",
    );
    const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
    assert.ok(input instanceof vscode.TabInputCustom, "a custom editor tab is active");
    assert.equal(input.viewType, "lorequill.pageEditor");
    assert.equal(input.uri.fsPath, page.resource);
    await vscode.commands.executeCommand("workbench.action.closeActiveEditor");
  });

  test("filters by title, file name, and alias", () => {
    api.setPageFilter("start");
    assert.deepEqual(outline(tree()), ["Welcome Page [welcome.md]"], "alias Start");

    api.setPageFilter("SETUP");
    assert.deepEqual(outline(tree()), ["guides", "  Installation [setup.md]"], "file name");

    api.setPageFilter("installation");
    assert.deepEqual(outline(tree()), ["guides", "  Installation [setup.md]"], "title");

    api.setPageFilter("nothing like this");
    assert.deepEqual(outline(tree()), ['No pages match "nothing like this".']);

    api.setPageFilter("");
    assert.deepEqual(outline(tree()), EXPECTED_TREE);
  });

  test("adds a new page to the tree", async () => {
    await waitForChange(
      () => writeFile(path.join(workspaceRoot(), "docs", "added.md"), "# Added Page\n"),
      "the new page",
      () => outline(tree()),
      (lines) => lines.includes("Added Page [added.md]"),
    );
  });

  test("marks drafts in the description", async () => {
    await waitForChange(
      () =>
        writeFile(
          profilePath(),
          profileYaml({
            locale: "en",
            exclude: '"**/index.md", "drafts/**"',
            drafts: '"guides/**"',
          }),
        ),
      "the tree with the draft marked",
      () => outline(tree()),
      (lines) =>
        sameLines(lines, [
          "guides",
          "  Installation [setup.md · Draft]",
          "no-title.md",
          "Welcome Page [welcome.md]",
        ]),
    );
  });

  test("applies a changed profile and explains an invalid one", async () => {
    // Profile change: exclude one more page.
    await waitForChange(
      () =>
        writeFile(
          profilePath(),
          profileYaml({ locale: "en", exclude: '"**/index.md", "drafts/**", "welcome.md"' }),
        ),
      "the tree without the excluded page",
      () => outline(tree()),
      (lines) => sameLines(lines, ["guides", "  Installation [setup.md]", "no-title.md"]),
    );

    // Invalid profile: one actionable message instead of pages.
    const invalid = await waitForChange(
      () => writeFile(profilePath(), `${profileYaml({ locale: "en" })}bogus: true\n`),
      "the invalid profile message",
      () => tree(),
      (nodes) => nodes.length === 1 && nodes[0]?.command === "lorequill.openProfile",
    );
    assert.equal(invalid.length, 1);
    const [message] = invalid;
    assert.match(message?.label ?? "", /The profile is invalid\./);
    assert.match(message?.label ?? "", /The key "bogus" is not allowed/);
    assert.match(message?.label ?? "", /Managed editing is disabled/);

    // An unsupported version has its own message.
    await waitForChange(
      () => writeFile(profilePath(), "version: 2\ncontent: {root: docs, include: ['*.md']}\n"),
      "the unsupported version message",
      () => tree(),
      (nodes) => (nodes[0]?.label ?? "").includes("version 2 is not supported"),
    );

    // A missing profile.
    await waitForChange(
      () => rm(profilePath(), { force: true }),
      "the missing profile message",
      () => tree(),
      (nodes) => (nodes[0]?.label ?? "").includes("No profile found"),
    );
  });

  test("explains a content root that does not exist", async () => {
    await waitForChange(
      () => writeFile(profilePath(), profileYaml({ locale: "en", root: "does-not-exist" })),
      "the content root message",
      () => tree(),
      (nodes) => (nodes[0]?.label ?? "").includes('"does-not-exist" does not exist'),
    );
    await mkdir(path.join(workspaceRoot(), "does-not-exist"), { recursive: true });
    await rm(path.join(workspaceRoot(), "does-not-exist"), { recursive: true });
  });

  test("shows a message when no page matches the include patterns", async () => {
    await waitForChange(
      () => writeFile(profilePath(), profileYaml({ locale: "en", include: '"nothing/*.md"' })),
      "the empty message",
      () => outline(tree()),
      (lines) => lines.length === 1 && (lines[0] ?? "").includes("No pages found"),
    );
  });
});

function sameLines(actual: readonly string[], expected: readonly string[]): boolean {
  return (
    actual.length === expected.length && actual.every((line, index) => line === expected[index])
  );
}
