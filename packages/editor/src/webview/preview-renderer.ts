import workerSource from "./preview-worker?worker";
import { renderPreview, type PreviewContext } from "../render";
import type { RenderRequest, RenderResult } from "./preview-worker";

/**
 * Renders the preview in a web worker and hands the HTML to `onRendered`. While a render runs,
 * newer requests replace each other, so only the latest text is rendered next and slow renders
 * never pile up. If no worker can be started, rendering falls back to the main thread.
 */
export class PreviewRenderer {
  private worker: Worker | undefined;
  private sent: Omit<RenderRequest, "id"> | undefined;
  private next: Omit<RenderRequest, "id"> | undefined;
  private lastId = 0;

  constructor(private readonly onRendered: (html: string) => void) {
    try {
      const url = URL.createObjectURL(new Blob([workerSource], { type: "text/javascript" }));
      const worker = new Worker(url);
      worker.onmessage = (event: MessageEvent<RenderResult>) => {
        this.receive(event.data);
      };
      worker.onerror = () => {
        this.fallBack();
      };
      this.worker = worker;
    } catch {
      this.worker = undefined;
    }
  }

  /** True while a render is running or waiting. */
  get busy(): boolean {
    return this.sent !== undefined || this.next !== undefined;
  }

  render(text: string, context: PreviewContext): void {
    if (!this.worker) {
      this.onRendered(renderPreview(text, context));
      return;
    }
    if (this.sent) {
      this.next = { text, context };
      return;
    }
    this.send({ text, context });
  }

  private send(request: Omit<RenderRequest, "id">): void {
    this.sent = request;
    this.lastId++;
    this.worker?.postMessage({ id: this.lastId, ...request } satisfies RenderRequest);
  }

  private receive(result: RenderResult): void {
    if (result.id !== this.lastId) {
      return;
    }
    const failed = this.sent;
    this.sent = undefined;
    const next = this.next;
    this.next = undefined;
    if (next) {
      this.send(next);
    }
    if ("html" in result) {
      this.onRendered(result.html);
    } else if (!next && failed) {
      // The renderer itself failed: the main thread reports it the same way it always did.
      this.onRendered(renderPreview(failed.text, failed.context));
    }
  }

  /** The worker could not run (for example, blocked by the environment): render here instead. */
  private fallBack(): void {
    // Visible in the webview developer tools; the preview itself keeps working.
    // eslint-disable-next-line no-console
    console.warn("Lorequill: the preview worker failed; rendering on the main thread.");
    this.worker?.terminate();
    this.worker = undefined;
    const pending = this.next ?? this.sent;
    this.sent = undefined;
    this.next = undefined;
    if (pending) {
      this.onRendered(renderPreview(pending.text, pending.context));
    }
  }
}
