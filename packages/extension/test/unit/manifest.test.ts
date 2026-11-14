import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

interface Manifest {
  name: string;
  version: string;
  publisher: string;
  repository: { url: string };
  license: string;
  main: string;
  engines: { vscode: string };
  activationEvents: string[];
  capabilities: { untrustedWorkspaces: { supported: unknown } };
  contributes: {
    commands: { command: string; title: string; category?: string }[];
    viewsContainers?: Record<string, { id: string; title: string; icon: string }[]>;
    views: Record<string, { id: string; name: string; when?: string; type?: string }[]>;
    viewsWelcome: { view: string; contents: string; when?: string }[];
    menus: Record<string, { command: string; when?: string }[]>;
    keybindings?: { command: string; key: string; when?: string }[];
    yamlValidation?: { fileMatch: string; url: string }[];
  };
}

const packageRoot = resolve(import.meta.dirname, "../..");
const manifest = JSON.parse(readFileSync(resolve(packageRoot, "package.json"), "utf8")) as Manifest;
const english = JSON.parse(
  readFileSync(resolve(packageRoot, "package.nls.json"), "utf8"),
) as Record<string, string>;
const german = JSON.parse(
  readFileSync(resolve(packageRoot, "package.nls.de.json"), "utf8"),
) as Record<string, string>;

function collectNlsReferences(value: unknown, found: Set<string>): void {
  if (typeof value === "string") {
    const match = /^%(.+)%$/.exec(value);
    if (match?.[1]) {
      found.add(match[1]);
    }
  } else if (Array.isArray(value)) {
    value.forEach((item) => {
      collectNlsReferences(item, found);
    });
  } else if (typeof value === "object" && value !== null) {
    Object.values(value).forEach((item) => {
      collectNlsReferences(item, found);
    });
  }
}

function sourceText(): string {
  const directory = resolve(packageRoot, "src");
  return readdirSync(directory, { recursive: true, encoding: "utf8" })
    .filter((name) => name.endsWith(".ts"))
    .map((name) => readFileSync(resolve(directory, name), "utf8"))
    .join("\n");
}

describe("extension manifest", () => {
  it("declares the Apache-2.0 license identifier", () => {
    expect(manifest.license).toBe("Apache-2.0");
  });

  it("points at the bundled entry point", () => {
    expect(manifest.main).toBe("./dist/extension.js");
  });

  it("limits functionality in untrusted workspaces", () => {
    expect(manifest.capabilities.untrustedWorkspaces.supported).toBe("limited");
  });

  it("only activates for repositories that contain a profile", () => {
    expect(manifest.activationEvents).toEqual(["workspaceContains:.lorequill/config.yaml"]);
  });

  it("prefixes every command with the lorequill namespace", () => {
    for (const { command } of manifest.contributes.commands) {
      expect(command.startsWith("lorequill.")).toBe(true);
    }
  });

  it("registers every contributed command in the source", () => {
    const source = sourceText();
    for (const { command } of manifest.contributes.commands) {
      expect(source, command).toContain(`"${command}"`);
    }
  });

  it("only mentions contributed commands in menus", () => {
    const commands = new Set(manifest.contributes.commands.map(({ command }) => command));
    for (const entries of Object.values(manifest.contributes.menus)) {
      for (const { command } of entries) {
        expect(commands.has(command), command).toBe(true);
      }
    }
  });
});

describe("Pages view", () => {
  const [view] = manifest.contributes.views.lorequill ?? [];

  it("is contributed to the Lorequill view container and only after activation", () => {
    expect(view?.id).toBe("lorequill.pages");
    expect(view?.when).toBe("lorequill.enabled");
    expect(manifest.contributes.views.explorer).toBeUndefined();
  });

  it("is tested in CI with the minimum VS Code version it declares", () => {
    const minimum = /^\^(\d+\.\d+\.\d+)$/.exec(manifest.engines.vscode)?.[1];
    const workflow = readFileSync(resolve(packageRoot, "../../.github/workflows/ci.yml"), "utf8");
    expect(minimum).toBeDefined();
    expect(workflow).toContain(`vscode: "${minimum ?? ""}"`);
  });

  it("has a Lorequill view container in the activity bar with a packaged icon", () => {
    const [container] = manifest.contributes.viewsContainers?.activitybar ?? [];
    expect(container?.id).toBe("lorequill");
    expect(container?.title).toMatch(/^%.+%$/);
    expect(existsSync(resolve(packageRoot, container?.icon ?? "missing"))).toBe(true);
    expect(readFileSync(resolve(packageRoot, ".vscodeignore"), "utf8")).toContain("!resources/**");
  });

  it("offers the profile schema for config.yaml and ships it in the VSIX", () => {
    expect(manifest.contributes.yamlValidation).toEqual([
      { fileMatch: "**/.lorequill/config.yaml", url: "./dist/profile.schema.json" },
    ]);
    expect(readFileSync(resolve(packageRoot, ".vscodeignore"), "utf8")).toContain(
      "!dist/profile.schema.json",
    );
    expect(readFileSync(resolve(packageRoot, "esbuild.mjs"), "utf8")).toContain(
      '"../profile/schema/profile.schema.json", "dist/profile.schema.json"',
    );
  });

  it("explains untrusted workspaces in the empty view", () => {
    const welcome = manifest.contributes.viewsWelcome.find(
      (entry) => entry.view === "lorequill.pages",
    );
    expect(welcome?.when).toBe("!isWorkspaceTrusted");
    expect(welcome?.contents).toMatch(/^%.+%$/);
  });

  it("offers new page, check, filter, clear filter, and refresh in the view title", () => {
    const entries = manifest.contributes.menus["view/title"] ?? [];
    expect(entries.map(({ command }) => command)).toEqual([
      "lorequill.newPage",
      "lorequill.checkPages",
      "lorequill.filterPages",
      "lorequill.clearPageFilter",
      "lorequill.refreshPages",
    ]);
  });

  it("offers Commit and Submit in the Source Control title bar of Git repositories", () => {
    const when = "scmProvider == git && lorequill.enabled && isWorkspaceTrusted";
    expect(manifest.contributes.menus["scm/title"]).toEqual([
      expect.objectContaining({ command: "lorequill.commit", when }),
      expect.objectContaining({ command: "lorequill.submit", when }),
    ]);
  });

  it("offers a plus action on directories and folders", () => {
    const entries = manifest.contributes.menus["view/item/context"] ?? [];
    expect(entries).toContainEqual(
      expect.objectContaining({
        command: "lorequill.newPage",
        group: "inline",
        when: "view == lorequill.pages && (viewItem == directory || viewItem == folder) && isWorkspaceTrusted",
      }),
    );
  });

  it("hides commands that need pages from the command palette in untrusted workspaces", () => {
    const entries = manifest.contributes.menus.commandPalette ?? [];
    for (const { command, when } of entries) {
      // `false` hides commands that only make sense from a view, such as Go to Heading.
      if (command !== "lorequill.clearPageFilter" && when !== "false") {
        expect(when, command).toContain("isWorkspaceTrusted");
      }
    }
  });
});

describe("Outline view", () => {
  const views = manifest.contributes.views.lorequill ?? [];

  it("follows the Pages view in the Lorequill view container", () => {
    expect(views.map(({ id }) => id)).toEqual([
      "lorequill.pages",
      "lorequill.outline",
      "lorequill.properties",
    ]);
    expect(views[1]?.when).toBe("lorequill.enabled");
  });

  it("is followed by the Properties webview view", () => {
    expect(views[2]).toEqual({
      type: "webview",
      id: "lorequill.properties",
      name: "%lorequill.view.properties%",
      when: "lorequill.enabled",
    });
  });

  it("explains an untrusted workspace, a missing page, and a page without headings", () => {
    const welcome = manifest.contributes.viewsWelcome.filter(
      (entry) => entry.view === "lorequill.outline",
    );
    expect(welcome.map(({ when }) => when)).toEqual([
      "!isWorkspaceTrusted",
      "isWorkspaceTrusted && lorequill.outlineState != 'empty'",
      "isWorkspaceTrusted && lorequill.outlineState == 'empty'",
    ]);
  });

  it("hides Go to Heading from the command palette", () => {
    const entry = (manifest.contributes.menus.commandPalette ?? []).find(
      ({ command }) => command === "lorequill.outline.reveal",
    );
    expect(entry?.when).toBe("false");
  });
});

describe("manifest translations", () => {
  const references = new Set<string>();
  collectNlsReferences(manifest.contributes, references);

  it("references only keys that exist in the English and German files", () => {
    expect(references.size).toBeGreaterThan(0);
    for (const key of references) {
      expect(english[key], `en ${key}`).toBeTypeOf("string");
      expect(german[key], `de ${key}`).toBeTypeOf("string");
    }
  });

  it("has no unused keys", () => {
    for (const key of Object.keys(english)) {
      expect(references.has(key), key).toBe(true);
    }
  });

  it("has the same keys in both files", () => {
    expect(Object.keys(german).sort()).toEqual(Object.keys(english).sort());
  });

  it("uses Swiss spelling in German", () => {
    for (const text of Object.values(german)) {
      expect(text).not.toContain("ß");
    }
  });
});

describe("release identity", () => {
  const repositoryRoot = resolve(packageRoot, "../..");
  const packages = readdirSync(resolve(repositoryRoot, "packages")).map((directory) => ({
    directory,
    manifest: JSON.parse(
      readFileSync(resolve(repositoryRoot, "packages", directory, "package.json"), "utf8"),
    ) as { name: string; version: string; license: string },
  }));

  it("declares Apache-2.0 for every first-party package and the workspace", () => {
    const workspace = JSON.parse(readFileSync(resolve(repositoryRoot, "package.json"), "utf8")) as {
      license: string;
    };
    expect(workspace.license).toBe("Apache-2.0");
    for (const { directory, manifest: entry } of packages) {
      expect(entry.license, directory).toBe("Apache-2.0");
    }
  });

  it("releases all packages with one version, so the extension and the engine match", () => {
    const versions = new Set(packages.map(({ manifest: entry }) => entry.version));
    expect([...versions]).toEqual([manifest.version]);
  });

  it("names the publisher and the repository", () => {
    expect(manifest.publisher).toBe("potamico");
    expect(manifest.repository.url).toBe("https://github.com/potamico/lorequill.git");
  });
});

describe("keybindings (AT 60)", () => {
  const keybindings = manifest.contributes.keybindings ?? [];

  it("apply only while the Lorequill editor is active", () => {
    expect(keybindings.length).toBeGreaterThan(0);
    for (const binding of keybindings) {
      expect(binding.when ?? "", binding.key).toMatch(
        /^activeCustomEditorId == 'lorequill\.pageEditor' && /,
      );
    }
  });

  it("leave formatting shortcuts such as Ctrl+B to VS Code outside the editor", () => {
    // Formatting keys live in the webview's own keymap, so VS Code keeps them elsewhere.
    expect(keybindings.map(({ key }) => key)).not.toContain("ctrl+b");
    expect(keybindings.map(({ key }) => key)).not.toContain("ctrl+i");
  });
});
