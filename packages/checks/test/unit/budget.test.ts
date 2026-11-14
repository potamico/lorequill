import { describe, expect, it } from "vitest";
import { runChecks } from "../../src";
import { memorySnapshot, profileWith } from "./helpers";

/**
 * Performance budget of specification §15: 1,000 pages plus one 1 MiB page must be checked within
 * 30 seconds on the CI runners (decision D7; a failure message shows the measured time).
 */
describe("performance budget", () => {
  it("checks 1,000 pages and a 1 MiB page within 30 seconds", async () => {
    const files: Record<string, string> = {};
    for (let index = 0; index < 1000; index++) {
      const next = (index + 1) % 1000;
      files[`section-${String(index % 20)}/page-${String(index)}.md`] = [
        "---",
        `id: KO-${String(index)}`,
        `title: Page ${String(index)}`,
        "---",
        "",
        `# Page ${String(index)}`,
        "",
        `See [next](../section-${String(next % 20)}/page-${String(next)}.md#page-${String(next)}).`,
        "",
        '!!! note "Note"',
        `    rel: related, [self](#page-${String(index)})`,
        "",
        "## Details",
        "",
        "Text ".repeat(200),
        "",
      ].join("\n");
    }
    const paragraph = `${"Lorem ipsum dolor sit amet [link](large.md#large). ".repeat(20)}\n\n`;
    files["large.md"] =
      `# Large\n\n${paragraph.repeat(Math.ceil((1024 * 1024) / paragraph.length))}`;

    const profile = profileWith([
      { id: "links", rule: "relative-links" },
      { id: "todo", rule: "forbidden-text", text: "TODO" },
      { id: "ids", rule: "unique-field", field: "id" },
      { id: "format", rule: "field-format", field: "id", prefixes: ["KO"] },
    ]);
    const started = performance.now();
    const result = await runChecks({ profile, snapshot: memorySnapshot(files) });
    const seconds = (performance.now() - started) / 1000;

    expect(result.status).toBe("failed");
    expect(result.findings.every(({ code }) => code === "field-format/missing")).toBe(true);
    expect(result.pagesChecked).toBe(1001);
    expect(
      seconds,
      `${String(result.pagesChecked)} pages took ${seconds.toFixed(2)} s`,
    ).toBeLessThan(30);
  }, 60_000);
});
