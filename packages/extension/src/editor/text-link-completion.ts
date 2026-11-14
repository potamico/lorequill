import { LIMITS, linkDestinationContext, matchCompletions } from "@lorequill/editor";
import * as vscode from "vscode";
import { noLinkAt } from "../core/links/link-items";
import type { LinkService } from "./link-service";

/** Characters after which VS Code asks for link completions without a typed letter. */
export const LINK_TRIGGER_CHARACTERS = ["(", "/", "#"] as const;

/**
 * Link completion in VS Code's text editor (specification §8), for Markdown pages in a content
 * root. It offers the same items as the Lorequill editor and matches the typed text against
 * path, title, and aliases with the same `matchCompletions`.
 *
 * VS Code filters completion items itself by their `filterText`, which knows only one text per
 * item. So the provider filters and ranks the items, gives every item the typed text as
 * `filterText` and its rank as `sortText`, and marks the list incomplete: VS Code then asks again
 * after every typed character instead of filtering on its own.
 */
export class TextLinkCompletionProvider implements vscode.CompletionItemProvider {
  constructor(private readonly links: LinkService) {}

  async provideCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
    token: vscode.CancellationToken,
  ): Promise<vscode.CompletionList | undefined> {
    const linePrefix = document.lineAt(position.line).text.slice(0, position.character);
    const where = linkDestinationContext(linePrefix);
    if (
      !where ||
      !this.links.sourceOf(document.uri) ||
      noLinkAt(document.getText(), document.offsetAt(position))
    ) {
      return undefined;
    }
    const items = await this.links.completions(
      document.uri,
      where.kind === "anchor" ? where.page : undefined,
    );
    if (token.isCancellationRequested) {
      return undefined;
    }
    const typed = linePrefix.slice(where.start);
    const range = new vscode.Range(position.line, where.start, position.line, position.character);
    const kind =
      where.kind === "anchor"
        ? vscode.CompletionItemKind.Reference
        : vscode.CompletionItemKind.File;
    const matched = matchCompletions(items, typed).slice(0, LIMITS.maxCompletions);
    const width = String(matched.length).length;
    return new vscode.CompletionList(
      matched.map((item, index) => {
        const completion = new vscode.CompletionItem(
          { label: item.label, ...(item.detail === undefined ? {} : { description: item.detail }) },
          kind,
        );
        completion.insertText = item.label;
        completion.range = range;
        completion.filterText = typed;
        completion.sortText = String(index).padStart(width, "0");
        return completion;
      }),
      true,
    );
  }
}
