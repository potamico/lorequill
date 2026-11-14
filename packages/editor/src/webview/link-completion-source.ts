import {
  autocompletion,
  type CompletionContext,
  type CompletionResult,
} from "@codemirror/autocomplete";
import type { Extension } from "@codemirror/state";
import { linkCompletionContext } from "../link-completion";
import { matchCompletions } from "../link-match";
import type { CompletionItem } from "../protocol";

/** How long a completion waits for the host before it gives up. */
const ANSWER_TIMEOUT_MS = 3000;

/** Text typed since the completion started that narrows the list without a new request. */
const VALID_FOR = /^[^()\s#<>]*$/;

/** Requests to the host, matched with their answers by id. */
export class CompletionRequests {
  private nextId = 1;
  private readonly waiting = new Map<number, (items: readonly CompletionItem[]) => void>();

  constructor(private readonly send: (id: number, anchorsOf?: string) => void) {}

  request(anchorsOf?: string): Promise<readonly CompletionItem[]> {
    const id = this.nextId++;
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.waiting.delete(id);
        resolve([]);
      }, ANSWER_TIMEOUT_MS);
      this.waiting.set(id, (items) => {
        clearTimeout(timer);
        resolve(items);
      });
      this.send(id, anchorsOf);
    });
  }

  answer(id: number, items: readonly CompletionItem[]): void {
    const resolve = this.waiting.get(id);
    this.waiting.delete(id);
    resolve?.(items);
  }
}

/**
 * Link completion (specification §8): inside an inline link destination it offers editable pages
 * as relative `.md` paths, and after `#` the anchors of the target page. The host computes both
 * with the same resolver and anchor code as Insert Link and the checks. The typed text is matched
 * against path, title, and aliases with `matchCompletions`, as in the text editor, so typing a
 * title finds a page whose path is different.
 */
export function linkCompletion(requests: CompletionRequests): Extension {
  const source = async (context: CompletionContext): Promise<CompletionResult | null> => {
    const where = linkCompletionContext(context.state, context.pos);
    if (!where) {
      return null;
    }
    const items = await requests.request(where.kind === "anchor" ? where.page : undefined);
    if (context.aborted || items.length === 0) {
      return null;
    }
    const type = where.kind === "anchor" ? "constant" : "text";
    const result = (typed: string): CompletionResult => ({
      from: where.from,
      options: matchCompletions(items, typed).map((item) => ({
        label: item.label,
        ...(item.detail === undefined ? {} : { detail: item.detail }),
        type,
      })),
      filter: false,
      // Typing inside the destination narrows the same items again without asking the host.
      update: (_current, from, _to, next) => {
        if (next.pos < from) {
          return null;
        }
        const text = next.state.sliceDoc(from, next.pos);
        return VALID_FOR.test(text) ? result(text) : null;
      },
    });
    return result(context.state.sliceDoc(where.from, context.pos));
  };
  return autocompletion({ override: [source], icons: false });
}
