import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  findFrontMatter,
  readFrontMatter,
  updateFrontMatter,
  type FrontMatterBlock,
  type FrontMatterData,
  type FrontMatterEdit,
} from "../../src/index";

const repositoryRoot = resolve(import.meta.dirname, "../../../..");

export function fixture(name: string): string {
  return readFileSync(resolve(repositoryRoot, "fixtures/markdown", name), "utf8");
}

export function toCrlf(text: string): string {
  return text.replace(/\r?\n/g, "\r\n");
}

export function blockOf(text: string): FrontMatterBlock {
  const block = findFrontMatter(text);
  if (!block) {
    throw new Error("Expected the text to have front matter.");
  }
  return block;
}

/** Everything after the front matter block. */
export function bodyOf(text: string): string {
  return text.slice(findFrontMatter(text)?.end ?? 0);
}

export function dataOf(text: string): FrontMatterData {
  const result = readFrontMatter(text);
  if (result.status !== "ok") {
    throw new Error(`Expected readable front matter, got status ${result.status}.`);
  }
  return result.data;
}

/** Applies edits and returns the new text; fails the test when the update is rejected. */
export function apply(text: string, ...edits: FrontMatterEdit[]): string {
  const result = updateFrontMatter(text, edits);
  if (!result.ok) {
    throw new Error(`Update rejected: ${result.issues.map((issue) => issue.code).join(", ")}`);
  }
  return result.text;
}
