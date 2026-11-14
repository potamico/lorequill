import { describe, expect, it } from "vitest";
import { extractLinks, parseMarkdown } from "../../src";

/** A small deterministic pseudo-random generator (mulberry32), so failures are reproducible. */
function random(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

const PROSE = ["Text", "more *words*", "a **b** c", "Ünïcode", "1. item", "- item", "> quote"];

/**
 * Builds a document from random blocks. Real links point to `real-N.md`; link syntax inside code
 * points to `code-N.md`. The parser must find every real link and no code link.
 */
function generate(next: () => number, size: number): { markdown: string; real: string[] } {
  const pick = <T>(items: readonly T[]): T => items[Math.floor(next() * items.length)] as T;
  const blocks: string[] = [];
  const real: string[] = [];
  for (let index = 0; index < size; index++) {
    const code = `[c](code-${String(index)}.md)`;
    switch (pick(["real", "fence", "tilde", "indented", "span", "prose", "admonition"])) {
      case "real":
        real.push(`real-${String(index)}.md`);
        blocks.push(`${pick(PROSE)} [r](real-${String(index)}.md) end`);
        break;
      case "fence":
        blocks.push(`\`\`\`${pick(["", "md", "python"])}\n${code}\n\`\`\``);
        break;
      case "tilde":
        blocks.push(`~~~~\n${code}\n\`\`\`\n${code}\n~~~~`);
        break;
      case "indented":
        // A plain paragraph first: after an admonition, an indented block would continue it.
        blocks.push(`Plain text\n\n    ${code}`);
        break;
      case "span":
        blocks.push(`${pick(PROSE)} \`${code}\` and \`\`${code}\`\``);
        break;
      case "prose":
        blocks.push(pick(PROSE));
        break;
      case "admonition":
        real.push(`real-${String(index)}.md`);
        blocks.push(
          `!!! note\n    \`${code}\`\n\n    \`\`\`\n    ${code}\n    \`\`\`\n\n    [r](real-${String(index)}.md)`,
        );
        break;
    }
  }
  return { markdown: `${blocks.join("\n\n")}\n`, real };
}

describe("link extraction never reports links inside code", () => {
  for (let seed = 1; seed <= 200; seed++) {
    it(`random document ${String(seed)}`, () => {
      const { markdown, real } = generate(random(seed), 12);
      const found = extractLinks(parseMarkdown(markdown)).map(({ destination }) => destination);
      expect(found, markdown).toEqual(real);
    });
  }
});
