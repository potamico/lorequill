import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parseProfile } from "../../src/index";
import { formatIssues, repositoryRoot } from "./helpers";

/**
 * These tests make sure the schema accepts the profiles printed in the repository's own
 * documentation. They only read the documents; neither the specification nor the example is a
 * source of fixtures for product code.
 */
function firstYamlBlock(relativePath: string): string {
  const markdown = readFileSync(resolve(repositoryRoot, relativePath), "utf8");
  const match = /```yaml\r?\n([\s\S]*?)```/.exec(markdown);
  if (!match?.[1]) {
    throw new Error(`No YAML block found in ${relativePath}`);
  }
  return match[1];
}

describe("documented profile examples", () => {
  it.each([
    ["the specification (section 6)", "docs/specification.md"],
    ["the EA Body of Knowledge example", "docs/examples/ea-body-of-knowledge.md"],
  ])("validates the profile shown in %s", (_name, path) => {
    const result = parseProfile(firstYamlBlock(path));
    expect(result.ok, result.ok ? "" : formatIssues(result.issues)).toBe(true);
  });
});
