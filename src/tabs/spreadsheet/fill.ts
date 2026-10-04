import type { RangeBounds } from "./range";
import type { CellAddress } from "./types";

// Where a fill-handle drag would write, given the selection being filled
// from and the cell the cursor is currently over. Like Excel, the drag goes
// in whichever direction the cursor is furthest outside the selection (a
// tie goes vertical); the filled strip spans the selection's width (or
// height, for a sideways fill) and runs out to the cursor. Null while the
// cursor is still inside the selection (nothing to fill).
export function computeFillTarget(
  selection: RangeBounds,
  hover: CellAddress,
  rows: number,
  cols: number,
): RangeBounds | null {
  const down = hover.row - selection.maxRow;
  const up = selection.minRow - hover.row;
  const right = hover.col - selection.maxCol;
  const left = selection.minCol - hover.col;
  const furthest = Math.max(down, up, right, left);
  if (furthest <= 0) return null;

  if (furthest === down) {
    return {
      minRow: selection.maxRow + 1,
      maxRow: Math.min(hover.row, rows - 1),
      minCol: selection.minCol,
      maxCol: selection.maxCol,
    };
  }
  if (furthest === up) {
    return {
      minRow: Math.max(hover.row, 0),
      maxRow: selection.minRow - 1,
      minCol: selection.minCol,
      maxCol: selection.maxCol,
    };
  }
  if (furthest === right) {
    return {
      minRow: selection.minRow,
      maxRow: selection.maxRow,
      minCol: selection.maxCol + 1,
      maxCol: Math.min(hover.col, cols - 1),
    };
  }
  return {
    minRow: selection.minRow,
    maxRow: selection.maxRow,
    minCol: Math.max(hover.col, 0),
    maxCol: selection.minCol - 1,
  };
}

// The selection after a fill: the original cells plus the filled strip.
export function unionBounds(a: RangeBounds, b: RangeBounds): RangeBounds {
  return {
    minRow: Math.min(a.minRow, b.minRow),
    maxRow: Math.max(a.maxRow, b.maxRow),
    minCol: Math.min(a.minCol, b.minCol),
    maxCol: Math.max(a.maxCol, b.maxCol),
  };
}
