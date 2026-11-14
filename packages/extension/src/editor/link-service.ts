import { LIMITS, type CompletionItem } from "@lorequill/editor";
import {
  createFileSystemTargetProvider,
  resolveLinkDestination,
  type AnchorSlugify,
} from "@lorequill/markdown";
import * as vscode from "vscode";
import type { Translate } from "../core/i18n";
import {
  anchorItems,
  escapeLinkText,
  linkDestination,
  pageLinkItems,
  slugifyOf,
  type AnchorItem,
} from "../core/links/link-items";
import type { PageEntry } from "../core/pages/scan";
import type { FolderRegistry } from "../folders/folder-registry";
import { pathInside } from "../folders/uri-paths";

/** A page as the source of a link: its folder's pages and anchor algorithm, and its own path. */
interface SourcePage {
  readonly uri: vscode.Uri;
  readonly path: string;
  readonly root: vscode.Uri;
  readonly pages: readonly PageEntry[];
  readonly slugify: AnchorSlugify;
}

/** A link the author chose with Insert Link. */
export interface ChosenLink {
  readonly text: string;
  readonly destination: string;
}

/**
 * Insert Link and link completion (specification §8, §10). Both offer the editable pages of the
 * source page's folder, write destinations with `relativeLinkPath`, and compute anchors with the
 * same code and `slugify` setting as the `relative-links` check, so what they insert is what the
 * check accepts. Target text comes from the open document if there is one (the current buffer),
 * otherwise from disk through the resolver's file provider, which stays inside the content root.
 */
export class LinkService {
  constructor(
    private readonly registry: FolderRegistry,
    private readonly translate: Translate,
  ) {}

  /** The page `uri` as a link source, if it lies in the content root of a ready folder. */
  sourceOf(uri: vscode.Uri): SourcePage | undefined {
    for (const model of this.registry.models()) {
      const root = model.contentRoot;
      if (model.status.kind !== "ready" || uri.scheme !== root?.scheme) {
        continue;
      }
      const path = pathInside(root, uri);
      if (path) {
        return {
          uri,
          path,
          root,
          pages: model.pages,
          slugify: slugifyOf(model.status.profile),
        };
      }
    }
    return undefined;
  }

  /**
   * Completion items for a link destination in `uri`: pages with their title and aliases, or the
   * anchors of one page with their heading text. Unfiltered; callers match the typed text.
   */
  async completions(uri: vscode.Uri, anchorsOf?: string): Promise<CompletionItem[]> {
    const source = this.sourceOf(uri);
    if (!source) {
      return [];
    }
    if (anchorsOf === undefined) {
      return pageLinkItems(source.pages, source.path).map(({ page, destination }) => {
        const aliases = page.aliases
          .filter((alias) => alias.length <= LIMITS.maxLinkText)
          .slice(0, LIMITS.maxKeywords);
        return {
          label: destination,
          detail: page.title.slice(0, LIMITS.maxLinkText),
          ...(aliases.length > 0 ? { keywords: aliases } : {}),
        };
      });
    }
    const target = anchorsOf === "" ? source.path : this.targetPath(source, anchorsOf);
    if (target === undefined) {
      return [];
    }
    return (await this.anchorsOf(source, target)).map((anchor) => ({
      label: anchor.id,
      detail: anchor.text.slice(0, LIMITS.maxLinkText),
    }));
  }

  /** The page a destination points to, if the resolver accepts it as a Markdown page. */
  private targetPath(source: SourcePage, destination: string): string | undefined {
    const resolved = resolveLinkDestination(source.path, destination);
    return resolved.kind === "path" && /\.md$/i.test(resolved.path) ? resolved.path : undefined;
  }

  private async anchorsOf(source: SourcePage, targetPath: string): Promise<AnchorItem[]> {
    const uri = vscode.Uri.joinPath(source.root, ...targetPath.split("/"));
    const open = vscode.workspace.textDocuments.find(
      (document) => document.uri.toString() === uri.toString(),
    );
    const text =
      open?.getText() ??
      (await createFileSystemTargetProvider(source.root.fsPath).readText(targetPath));
    return text === undefined ? [] : anchorItems(text, source.slugify);
  }

  /**
   * Insert Link: the author searches a page by title, path, or alias, optionally picks one of its
   * headings, and confirms the display text. `undefined` when cancelled or not a page.
   */
  async pick(uri: vscode.Uri, selection: string): Promise<ChosenLink | undefined> {
    const source = this.sourceOf(uri);
    if (!source) {
      void vscode.window.showWarningMessage(this.translate("links.notAPage"));
      return undefined;
    }
    const own = source.pages.find((page) => page.path === source.path);
    const items = [
      ...(own ? [{ page: own, destination: "" }] : []),
      ...pageLinkItems(source.pages, source.path),
    ].map((item) => ({
      label:
        item.page === own
          ? this.translate("links.thisPage", { title: item.page.title })
          : item.page.title,
      description: item.page.path,
      ...(item.page.aliases.length > 0
        ? { detail: this.translate("links.aliases", { aliases: item.page.aliases.join(", ") }) }
        : {}),
      item,
    }));
    const chosen = await vscode.window.showQuickPick(items, {
      title: this.translate("links.pickPage"),
      placeHolder: this.translate("links.pickPagePlaceholder"),
      matchOnDescription: true,
      matchOnDetail: true,
    });
    if (!chosen) {
      return undefined;
    }
    const target = chosen.item.page;
    const anchors = await this.anchorsOf(source, target.path);
    let anchor: AnchorItem | undefined;
    if (anchors.length > 0) {
      const whole = { label: this.translate("links.wholePage"), anchor: undefined };
      const headings = anchors.map((candidate) => ({
        label: `${"  ".repeat(Math.max(0, candidate.level - 1))}${candidate.text}`,
        description: `#${candidate.id}`,
        anchor: candidate,
      }));
      const picked = await vscode.window.showQuickPick(
        target === own ? headings : [whole, ...headings],
        { title: this.translate("links.pickHeading"), matchOnDescription: true },
      );
      if (!picked) {
        return undefined;
      }
      anchor = picked.anchor;
    }
    if (target === own && !anchor) {
      return undefined;
    }
    const proposed = selection.trim() !== "" ? selection : (anchor?.text ?? target.title);
    const text = await vscode.window.showInputBox({
      title: this.translate("links.text"),
      value: proposed.replace(/\s+/g, " ").trim(),
      validateInput: (value) =>
        value.trim() === "" ? this.translate("links.textEmpty") : undefined,
    });
    if (text === undefined) {
      return undefined;
    }
    return { text, destination: linkDestination(source.path, target.path, anchor?.id) };
  }

  /** Insert Link in a text editor: replaces the selection with the chosen link. */
  async insertIntoTextEditor(editor: vscode.TextEditor): Promise<void> {
    const selection = editor.document.getText(editor.selection);
    const link = await this.pick(editor.document.uri, selection);
    if (link) {
      await editor.edit((builder) => {
        builder.replace(editor.selection, `[${escapeLinkText(link.text)}](${link.destination})`);
      });
    }
  }
}
