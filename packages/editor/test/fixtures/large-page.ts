/**
 * A realistic page of about `size` bytes for the editing budget (specification §15): every
 * construct the live preview and the rendered preview handle, repeated in sections.
 */
export function largePage(size = 1024 * 1024): string {
  const sections: string[] = ["---", "title: Large page", "---", "", "# Large page", ""];
  let length = sections.join("\n").length;
  for (let index = 0; length < size; index++) {
    const n = String(index);
    const section = [
      `## Section ${n}`,
      "",
      `Some **bold**, *italic*, ~~old~~ and \`code\` text with a [link](other.md#part-${n}) and a`,
      `reference [link][ref-${n}]. ${"Lorem ipsum dolor sit amet, consectetur adipiscing elit. ".repeat(4)}`,
      "",
      `- Item one with [a link](sub/page-${n}.md)`,
      "- Item two",
      "    - Nested item",
      `- [ ] Open task ${n}`,
      "- [x] Done task",
      "",
      "| Name | Value | Note |",
      "|:-----|:-----:|-----:|",
      `| **A${n}** | \`1\` | [x](x.md) |`,
      "| B | 2 | text |",
      "",
      "```python",
      `def handler_${n}(event: dict) -> str:`,
      "    # Process the event",
      `    return f"{event['id']}" * ${n}`,
      "```",
      "",
      '!!! warning "Careful"',
      `    Admonition body with **bold** text and a [link](warn-${n}.md).`,
      "",
      '=== "YAML"',
      "",
      "    ```yaml",
      `    key: value-${n} # comment`,
      "    ```",
      "",
      '=== "Shell"',
      "",
      "    ```bash",
      `    echo "section ${n}"`,
      "    ```",
      "",
      "> A quote with *emphasis*.",
      "",
      `[ref-${n}]: https://example.org/${n}`,
      "",
      "---",
      "",
    ].join("\n");
    sections.push(section);
    length += section.length + 1;
  }
  return sections.join("\n");
}
