import { posix } from "node:path";
import type * as vscode from "vscode";
import { relativeInside } from "../core/paths";

/**
 * The path of `uri` relative to the folder or content root `root`, with `/` separators, or
 * `undefined` when it lies outside or has another scheme; `""` for the root itself. File URIs are
 * compared as file system paths, because the same file can come with a drive letter in different
 * case, depending on where VS Code got the URI from.
 */
export function pathInside(root: vscode.Uri, uri: vscode.Uri): string | undefined {
  if (uri.scheme !== root.scheme) {
    return undefined;
  }
  return uri.scheme === "file"
    ? relativeInside(root.fsPath, uri.fsPath)
    : relativeInside(root.path, uri.path, posix);
}
