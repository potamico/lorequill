/**
 * Scroll synchronization of `Both` (specification §8, AT 56): a pure mapping between source
 * lines and vertical positions in the rendered preview, based on the `data-line` of its blocks.
 *
 * Lines are fractional (line 3.5 is halfway through source line 3, 0-based). Between two anchors
 * the mapping is linear, so both directions are inverse to each other and the corresponding
 * source line and rendered block stay aligned to within the block that contains them.
 */

/** A rendered block that starts at source `line`, `top` pixels below the preview's start. */
export interface LineAnchor {
  readonly line: number;
  readonly top: number;
}

/**
 * Turns the blocks of a preview, in document order, into anchors usable for interpolation:
 * nested blocks that start on the same line, and blocks that appear out of source order (such as
 * footnotes, which are rendered at the end), are dropped, so both line and top strictly increase.
 * The start (line 0 at the top) and the end (`lineCount` at `height`) are always included.
 */
export function buildAnchors(
  blocks: readonly LineAnchor[],
  lineCount: number,
  height: number,
): LineAnchor[] {
  const anchors: LineAnchor[] = [{ line: 0, top: 0 }];
  for (const block of blocks) {
    const last = anchors[anchors.length - 1];
    if (last && block.line > last.line && block.top > last.top && block.line < lineCount) {
      anchors.push(block);
    } else if (last && block.line === 0 && last.line === 0 && block.top >= 0) {
      // The first block may start below the preview's padding: line 0 belongs to it.
      anchors[anchors.length - 1] = { line: 0, top: block.top };
    }
  }
  const last = anchors[anchors.length - 1];
  if (last && lineCount > last.line && height > last.top) {
    anchors.push({ line: lineCount, top: height });
  }
  return anchors;
}

/** The preview position of a fractional source line. */
export function topForLine(anchors: readonly LineAnchor[], line: number): number {
  return interpolate(anchors, line, "line", "top");
}

/** The fractional source line at a preview position. */
export function lineForTop(anchors: readonly LineAnchor[], top: number): number {
  return interpolate(anchors, top, "top", "line");
}

function interpolate(
  anchors: readonly LineAnchor[],
  value: number,
  from: keyof LineAnchor,
  to: keyof LineAnchor,
): number {
  const first = anchors[0];
  if (!first) {
    return 0;
  }
  // Binary search for the last anchor at or before `value`.
  let low = 0;
  let high = anchors.length - 1;
  while (low < high) {
    const middle = (low + high + 1) >> 1;
    if ((anchors[middle]?.[from] ?? 0) <= value) {
      low = middle;
    } else {
      high = middle - 1;
    }
  }
  const start = anchors[low] ?? first;
  const end = anchors[low + 1];
  if (value <= start[from] || !end) {
    return start[to];
  }
  const ratio = (value - start[from]) / (end[from] - start[from]);
  return start[to] + ratio * (end[to] - start[to]);
}

/**
 * The source lines (0-based) of an editor block: its first line and how many lines it covers.
 * In live preview one block can cover several lines, such as the hidden front matter or a table
 * shown as a grid.
 */
export interface BlockLines {
  readonly first: number;
  readonly count: number;
}

/**
 * The fractional source line at `within` (0 at the top, 1 at the bottom) of an editor block.
 * The lines of a block that covers several are spread evenly over its height.
 */
export function lineInBlock(block: BlockLines, within: number): number {
  return block.first + Math.min(Math.max(within, 0), 1) * block.count;
}

/** Where a fractional source line lies in an editor block, from 0 (top) to 1 (bottom). */
export function offsetInBlock(block: BlockLines, line: number): number {
  return block.count > 0 ? Math.min(Math.max((line - block.first) / block.count, 0), 1) : 0;
}
