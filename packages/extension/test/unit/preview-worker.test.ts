import path from "node:path";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { buildWorker } from "../../webview-build.mjs";

const entry = path.resolve(__dirname, "../../../editor/src/webview/preview-worker.ts");

describe("preview worker bundle", () => {
  it("renders a page in a context without DOM globals", async () => {
    const result = await buildWorker(entry);
    const [output] = result.outputFiles;
    if (!output) {
      throw new Error("no worker output");
    }
    const answers: unknown[] = [];
    // Only what a dedicated worker offers: no `document` and no `window`.
    const scope: Record<string, unknown> = {
      postMessage: (message: unknown) => answers.push(message),
    };
    scope.self = scope;
    runInNewContext(output.text, scope);
    const onmessage = scope.onmessage as (event: { data: unknown }) => void;
    onmessage({
      data: { id: 7, text: "# Title\n\n```js\nlet a = 1;\n```\n\nCaf&eacute;\n", context: {} },
    });
    expect(answers).toHaveLength(1);
    const [answer] = answers as { id: number; html?: string; error?: string }[];
    expect(answer?.error).toBeUndefined();
    expect(answer?.id).toBe(7);
    expect(answer?.html).toContain('<h1 data-line="0">Title</h1>');
    expect(answer?.html).toContain('<span class="tok-keyword">let</span>');
    // Named character references decode without the DOM.
    expect(answer?.html).toContain("Café");
  }, 60_000);
});
