import { renderPreview, type PreviewContext } from "../render";

/** A render request from the webview; `id` identifies the answer. */
export interface RenderRequest {
  readonly id: number;
  readonly text: string;
  readonly context: PreviewContext;
}

/** The rendered, sanitized HTML for a request, or the error that prevented it. */
export type RenderResult =
  { readonly id: number; readonly html: string } | { readonly id: number; readonly error: string };

// Renders the preview off the webview's main thread, so typing in `Both` is never blocked by a
// long page (specification §15). Runs the same renderer and sanitizer as the main thread.
const scope = self as unknown as {
  onmessage: ((event: MessageEvent<RenderRequest>) => void) | null;
  postMessage(message: RenderResult): void;
};

scope.onmessage = (event) => {
  const { id, text, context } = event.data;
  let result: RenderResult;
  try {
    result = { id, html: renderPreview(text, context) };
  } catch (error) {
    result = { id, error: error instanceof Error ? error.message : String(error) };
  }
  scope.postMessage(result);
};
