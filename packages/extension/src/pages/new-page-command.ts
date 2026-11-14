import { proposeFilename } from "@lorequill/markdown";
import type { Collection } from "@lorequill/profile";
import * as vscode from "vscode";
import type { MessageKey, Translate } from "../core/i18n";
import {
  checkFileName,
  collectionsForNewPage,
  newPageText,
  normalizeFileName,
  pagePathIn,
} from "../core/pages/new-page";
import type { FolderModel, FolderRegistry } from "../folders/folder-registry";
import { PAGE_EDITOR_VIEW_TYPE } from "../editor/page-editor";

export const NEW_PAGE_COMMAND = "lorequill.newPage";

/** What page creation asks the author; replaced by scripted answers in integration tests. */
export interface NewPagePrompts {
  /** The folder for a page created without a Pages tree element, among several. */
  chooseFolder(models: readonly FolderModel[]): Promise<FolderModel | undefined>;
  /** The title; `directory` is empty for the content root. */
  askTitle(directory: string): Promise<string | undefined>;
  /** Confirms or edits the proposed file name; `validate` describes a problem with a name. */
  askFileName(
    proposed: string,
    validate: (value: string) => string | undefined,
  ): Promise<string | undefined>;
  /** One of several matching collections; `undefined` when cancelled. */
  chooseCollection(candidates: readonly Collection[]): Promise<Collection | undefined>;
}

/** Where a Pages tree element asks to create a page: a folder model and a directory in it. */
interface Target {
  readonly model: FolderModel;
  readonly directory: string;
}

function targetOf(element: unknown): Target | undefined {
  if (typeof element !== "object" || element === null || !("kind" in element)) {
    return undefined;
  }
  const candidate = element as { kind: string; model?: FolderModel; node?: { path?: string } };
  if (
    candidate.kind === "directory" &&
    candidate.model &&
    typeof candidate.node?.path === "string"
  ) {
    return { model: candidate.model, directory: candidate.node.path };
  }
  if (candidate.kind === "folder" && candidate.model) {
    return { model: candidate.model, directory: "" };
  }
  return undefined;
}

/**
 * Creates a page in exactly the chosen directory (specification §6, §8): the author gives a title
 * and confirms or edits the proposed file name; collisions, invalid names, and anything that is
 * not a single file name are rejected. A single matching collection supplies its template and
 * defaults, several must be chosen explicitly, none gives a heading. The file is created through
 * a `WorkspaceEdit` that never overwrites, then opened in the Lorequill editor.
 */
export async function createPage(
  registry: FolderRegistry,
  translate: Translate,
  element?: unknown,
  prompts: NewPagePrompts = new VsCodeNewPagePrompts(translate),
): Promise<vscode.Uri | undefined> {
  const target = targetOf(element) ?? (await chooseFolder(registry, prompts));
  const root = target?.model.contentRoot;
  if (!target || !root || target.model.status.kind !== "ready") {
    return undefined;
  }
  const directoryUri =
    target.directory === "" ? root : vscode.Uri.joinPath(root, ...target.directory.split("/"));
  const existing = await fileNamesIn(directoryUri);

  const title = await prompts.askTitle(target.directory);
  if (title === undefined || title.trim() === "") {
    return undefined;
  }

  const describe = (value: string): string | undefined => {
    const problem = checkFileName(normalizeFileName(value), existing);
    return problem === undefined
      ? undefined
      : translate(`newpage.fileName.${problem}` as MessageKey);
  };
  const proposed = proposeFilename(title, existing);
  const entered = await prompts.askFileName(proposed, describe);
  if (entered === undefined) {
    return undefined;
  }
  const fileName = normalizeFileName(entered);
  const problem = describe(fileName);
  if (problem !== undefined) {
    void vscode.window.showErrorMessage(problem);
    return undefined;
  }

  const path = pagePathIn(target.directory, fileName);
  const candidates = collectionsForNewPage(target.model.status.profile.collections ?? [], path);
  const collection =
    candidates.length <= 1 ? candidates[0] : await prompts.chooseCollection(candidates);
  if (candidates.length > 1 && !collection) {
    return undefined;
  }

  const uri = vscode.Uri.joinPath(directoryUri, fileName);
  const edit = new vscode.WorkspaceEdit();
  edit.createFile(uri, {
    overwrite: false,
    ignoreIfExists: false,
    contents: new TextEncoder().encode(newPageText(title, path, collection)),
  });
  if (!(await vscode.workspace.applyEdit(edit))) {
    void vscode.window.showErrorMessage(translate("newpage.failed", { name: fileName }));
    return undefined;
  }
  await vscode.commands.executeCommand("vscode.openWith", uri, PAGE_EDITOR_VIEW_TYPE);
  return uri;
}

async function chooseFolder(
  registry: FolderRegistry,
  prompts: NewPagePrompts,
): Promise<Target | undefined> {
  const ready = registry
    .models()
    .filter((model) => model.status.kind === "ready" && model.contentRoot);
  const model = ready.length <= 1 ? ready[0] : await prompts.chooseFolder(ready);
  return model && { model, directory: "" };
}

/** Names of all entries in a directory (pages and other files), for collision checks. */
async function fileNamesIn(directory: vscode.Uri): Promise<string[]> {
  try {
    return (await vscode.workspace.fs.readDirectory(directory)).map(([name]) => name);
  } catch {
    return [];
  }
}

/** The page creation dialogs as VS Code shows them. */
export class VsCodeNewPagePrompts implements NewPagePrompts {
  constructor(private readonly translate: Translate) {}

  async chooseFolder(models: readonly FolderModel[]): Promise<FolderModel | undefined> {
    const picked = await vscode.window.showQuickPick(
      models.map((model) => ({ label: model.folder.name, model })),
      { title: this.translate("newpage.chooseFolder") },
    );
    return picked?.model;
  }

  async askTitle(directory: string): Promise<string | undefined> {
    const translate = this.translate;
    return vscode.window.showInputBox({
      title: translate("newpage.title"),
      prompt:
        directory === ""
          ? translate("newpage.inRoot")
          : translate("newpage.inDirectory", { directory }),
      validateInput: (value) => (value.trim() === "" ? translate("newpage.titleEmpty") : undefined),
    });
  }

  async askFileName(
    proposed: string,
    validate: (value: string) => string | undefined,
  ): Promise<string | undefined> {
    return vscode.window.showInputBox({
      title: this.translate("newpage.fileName"),
      value: proposed,
      valueSelection: [0, proposed.length - ".md".length],
      validateInput: validate,
    });
  }

  async chooseCollection(candidates: readonly Collection[]): Promise<Collection | undefined> {
    const picked = await vscode.window.showQuickPick(
      candidates.map((collection) => ({
        label: collection.label ?? collection.id,
        description: collection.id,
        collection,
      })),
      { title: this.translate("newpage.chooseCollection") },
    );
    return picked?.collection;
  }
}
