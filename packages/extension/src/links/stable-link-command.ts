import { readFrontMatterField } from "@lorequill/markdown";
import * as vscode from "vscode";
import { stableLink, type StableLinkResult } from "../core/links/stable-link";
import type { Translate } from "../core/i18n";
import type { FolderRegistry } from "../folders/folder-registry";
import { pathInside } from "../folders/uri-paths";
import type { PagesElement } from "../pages/pages-view";

export const COPY_STABLE_LINK_COMMAND = "lorequill.copyStableLink";

/**
 * `Copy Stable Link`: copies the address that keeps pointing at a page when it moves. The
 * page is the command's argument (a Pages view item or a URI), else the active editor's page.
 */
export function registerStableLinkCommand(
  registry: FolderRegistry,
  translate: Translate,
  activePage: () => vscode.Uri | undefined,
): vscode.Disposable {
  return vscode.commands.registerCommand(COPY_STABLE_LINK_COMMAND, async (argument: unknown) => {
    const uri = pageUri(argument) ?? activePage();
    const model = uri
      ? registry
          .models()
          .find(
            ({ contentRoot }) =>
              contentRoot !== undefined && pathInside(contentRoot, uri) !== undefined,
          )
      : undefined;
    if (!uri || model?.status.kind !== "ready") {
      void vscode.window.showWarningMessage(translate("links.stable.noPage"));
      return undefined;
    }
    const profile = model.status.profile;
    const field = profile.site?.stable_links?.field;
    let value: unknown;
    if (field !== undefined) {
      const document = await vscode.workspace.openTextDocument(uri);
      const read = readFrontMatterField(document.getText(), field);
      value = read.status === "ok" ? read.value : undefined;
    }
    const result = stableLink(profile, value);
    await report(result, translate);
    return result;
  });
}

async function report(result: StableLinkResult, translate: Translate): Promise<void> {
  switch (result.kind) {
    case "link":
      await vscode.env.clipboard.writeText(result.url);
      void vscode.window.showInformationMessage(
        translate("links.stable.copied", { url: result.url }),
      );
      return;
    case "not-configured":
      void vscode.window.showWarningMessage(translate("links.stable.notConfigured"));
      return;
    case "no-value":
      void vscode.window.showWarningMessage(
        translate("links.stable.noValue", { field: result.field }),
      );
      return;
  }
}

/** The page of a Pages view item or a URI argument. */
function pageUri(argument: unknown): vscode.Uri | undefined {
  if (argument instanceof vscode.Uri) {
    return argument;
  }
  const element = argument as Partial<PagesElement> | null | undefined;
  if (element?.kind === "page" && element.model?.contentRoot && element.node) {
    return vscode.Uri.joinPath(element.model.contentRoot, ...element.node.page.path.split("/"));
  }
  return undefined;
}
