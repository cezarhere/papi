import { CELL_HEIGHT, COL_HEADER_HEIGHT, ROW_HEADER_WIDTH } from "./constants";
import type { RangeBounds } from "./range";

// Pixel layout of the grid, measured from the grid element's top-left
// corner (headers included). Selection, the in-cell editor and mouse
// hit-testing are all computed from this instead of from the DOM, which is
// what lets cells stay un-rendered when only the selection changes.
export interface Geometry {
  // Left edge of each column; one extra entry for the right edge of the last.
  colLeft: number[];
  width: number;
  height: number;
}

export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export function buildGeometry(getWidth: (col: number) => number, rows: number, cols: number): Geometry {
  const colLeft = [ROW_HEADER_WIDTH];
  for (let col = 0; col < cols; col++) colLeft.push(colLeft[col] + getWidth(col));
  return { colLeft, width: colLeft[cols], height: COL_HEADER_HEIGHT + rows * CELL_HEIGHT };
}

export function rectFor(bounds: RangeBounds, geometry: Geometry): Rect {
  const left = geometry.colLeft[bounds.minCol];
  const top = COL_HEADER_HEIGHT + bounds.minRow * CELL_HEIGHT;
  return {
    left,
    top,
    width: geometry.colLeft[bounds.maxCol + 1] - left,
    height: (bounds.maxRow - bounds.minRow + 1) * CELL_HEIGHT,
  };
}

// Column under an x offset, clamped to the grid — so a drag that runs off
// the edge keeps tracking the nearest column.
export function colAt(x: number, geometry: Geometry): number {
  const last = geometry.colLeft.length - 2;
  for (let col = 0; col <= last; col++) {
    if (x < geometry.colLeft[col + 1]) return col;
  }
  return last;
}

export function rowAt(y: number, rows: number): number {
  return Math.min(rows - 1, Math.max(0, Math.floor((y - COL_HEADER_HEIGHT) / CELL_HEIGHT)));
}
