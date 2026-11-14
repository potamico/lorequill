import { execFileSync } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import * as path from "node:path";

/** Neutral example profile used by the scenarios; it is not the example profile of any product. */
export function profileYaml(options: {
  locale?: string;
  root?: string;
  include?: string;
  exclude?: string;
  drafts?: string;
}): string {
  const lines = ["version: 1"];
  if (options.locale) {
    lines.push(`locale: ${options.locale}`);
  }
  lines.push(
    "content:",
    `  root: ${options.root ?? "docs"}`,
    `  include: [${options.include ?? '"**/*.md"'}]`,
  );
  if (options.exclude) {
    lines.push(`  exclude: [${options.exclude}]`);
  }
  if (options.drafts) {
    lines.push(`  drafts: [${options.drafts}]`);
  }
  return `${lines.join("\n")}\n`;
}

async function writeFiles(root: string, files: Record<string, string>): Promise<void> {
  for (const [relative, content] of Object.entries(files)) {
    const target = path.join(root, ...relative.split("/"));
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, content);
  }
}

/** Runs Git in `cwd` with an isolated configuration and a fixed identity. */
function git(cwd: string, ...args: string[]): void {
  const env: NodeJS.ProcessEnv = {};
  for (const [name, value] of Object.entries(process.env)) {
    if (!name.startsWith("GIT_")) {
      env[name] = value;
    }
  }
  execFileSync("git", args, {
    cwd,
    // Not os.devNull, which is \\.\nul on Windows: Git for Windows cannot open it, but maps "/dev/null".
    env: { ...env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" },
    stdio: "ignore",
  });
}

async function initRepository(root: string, files: Record<string, string>): Promise<void> {
  await writeFiles(root, files);
  git(root, "init", "-q", "-b", "main");
  git(root, "config", "user.name", "Lorequill Test");
  git(root, "config", "user.email", "test@example.invalid");
  git(root, "config", "commit.gpgsign", "false");
  git(root, "add", "-A");
  git(root, "commit", "-q", "--no-verify", "-m", "initial");
}

export interface ScenarioWorkspaces {
  /** Folder with a valid profile; used by the trusted and the untrusted scenario. */
  readonly single: string;
  /** `.code-workspace` file with four folders: valid, valid with another locale, invalid, none. */
  readonly multiRoot: string;
  /** Folder whose profile has checks and whose pages contain findings. */
  readonly checks: string;
  /** Folder for the page editor: LF and CRLF pages, and Markdown outside the content root. */
  readonly editor: string;
  /**
   * `.code-workspace` file with two Git folders: `site`, a repository on a feature branch whose
   * remote `origin` is the local bare repository `remote.git`, and `outer`, a repository whose
   * content root lies in the nested repository `inner`.
   */
  readonly git: string;
}

/** Creates the workspaces below `base`, replacing earlier ones. */
export async function createWorkspaces(base: string): Promise<ScenarioWorkspaces> {
  await rm(base, { recursive: true, force: true });

  const single = path.join(base, "single");
  await writeFiles(single, {
    ".lorequill/config.yaml": profileYaml({
      locale: "en",
      exclude: '"**/index.md", "drafts/**"',
    }),
    "docs/index.md": "# Home\n",
    "docs/welcome.md": "---\ntitle: Welcome Page\naliases: [Start]\n---\n# Heading\n",
    "docs/no-title.md": "Just text.\n",
    "docs/guides/index.md": "# Guides\n",
    "docs/guides/setup.md": "# Installation\n",
    "docs/drafts/idea.md": "# Idea\n",
  });

  const multi = path.join(base, "multi");
  await writeFiles(path.join(multi, "alpha"), {
    ".lorequill/config.yaml": profileYaml({ locale: "en" }),
    "docs/one.md": "# One\n",
    "docs/two.md": "# Two\n",
  });
  await writeFiles(path.join(multi, "beta"), {
    ".lorequill/config.yaml": profileYaml({ locale: "de-CH", root: "content", include: '"*.md"' }),
    "content/notes.txt": "not a page",
    "content/sub/hidden-by-pattern.md": "# Not matched by the include pattern\n",
  });
  await writeFiles(path.join(multi, "gamma"), {
    ".lorequill/config.yaml": `${profileYaml({ locale: "en" })}bogus: true\n`,
    "docs/three.md": "# Three\n",
  });
  await writeFiles(path.join(multi, "delta"), { "docs/four.md": "# Four\n" });

  const workspaceFile = path.join(multi, "lorequill.code-workspace");
  await writeFile(
    workspaceFile,
    JSON.stringify({
      folders: ["alpha", "beta", "gamma", "delta"].map((name) => ({ path: name })),
    }),
  );
  const checks = path.join(base, "checks");
  await writeFiles(checks, {
    ".lorequill/config.yaml": `${profileYaml({ locale: "de-CH" })}checks:
  rules:
    - { id: links, rule: relative-links }
    - { id: wikilinks, rule: forbidden-text, text: "[[" }
`,
    "docs/index.md": "# Start\n\n[Setup](setup.md)\n",
    "docs/clean.md": "# Clean\n\n[Start](index.md#start)\n",
    "docs/notes.txt": "not a page",
  });

  const editor = path.join(base, "editor");
  await writeFiles(editor, {
    ".lorequill/config.yaml": `${profileYaml({ locale: "en" })}site:
  url: https://docs.example.org/
  stable_links: { field: id, path: "id/{value}/" }
collections:
  - id: concept
    label: Concept
    folder: "{domain}/concepts"
    match: { field: type, equals: concept }
    fields:
      - { key: title, label: Title, widget: string, required: true }
      - { key: type, widget: hidden, default: concept }
      - { key: status, widget: select, options: [draft, approved], default: draft }
      - { key: reviewed, widget: date }
      - { key: aliases, widget: list }
`,
    "docs/iam/concepts/access.md":
      "---\n# keep this comment\ntitle: Access\ntype: concept\naliases: [IAM]\ncustom: kept\n---\n# Access\n\nBody line  \n",
    "docs/broken.md": "---\ntitle: a\ntitle: b\n---\n# Broken\n",
    "docs/lf.md": "---\ntitle: LF\n---\n# LF page\n\nFirst line\n",
    "docs/crlf.md": "# CRLF page\r\n\r\nFirst line\r\n",
    "docs/second.md": "# Second\n",
    "docs/outline.md":
      "---\ntitle: Outline\n---\n# Guide\n\nIntro\n\n## Install\n\n### Linux\n\n## Use\n",
    "docs/links.md": "# Links\n\n[Second](second.md) and [Install](outline.md#install)\n",
    "README.md": "# Readme outside the content root\n",
  });

  const gitBase = path.join(base, "git");
  const site = path.join(gitBase, "site");
  await initRepository(site, {
    ".lorequill/config.yaml": `${profileYaml({ locale: "en" })}review:
  base_branch: main
checks:
  rules:
    - { id: links, rule: relative-links }
`,
    "docs/a.md": "# A\n",
    "docs/b.md": "# B\n",
    "README.md": "# Site\n",
  });
  // A local bare repository stands in for the Git host's repository.
  const remote = path.join(gitBase, "remote.git");
  await mkdir(remote, { recursive: true });
  git(remote, "init", "-q", "--bare", "-b", "main");
  git(site, "remote", "add", "origin", remote);
  git(site, "push", "-q", "origin", "main");
  git(site, "checkout", "-q", "-b", "feature/docs");
  const outer = path.join(gitBase, "outer");
  await initRepository(outer, {
    ".lorequill/config.yaml": profileYaml({ locale: "en", root: "inner/docs" }),
    "README.md": "# Outer\n",
  });
  await initRepository(path.join(outer, "inner"), { "docs/inner.md": "# Inner\n" });
  const gitWorkspace = path.join(gitBase, "git.code-workspace");
  await writeFile(gitWorkspace, JSON.stringify({ folders: [{ path: "site" }, { path: "outer" }] }));

  return { single, multiRoot: workspaceFile, checks, editor, git: gitWorkspace };
}
