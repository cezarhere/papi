import type { CellAddress, CellRange } from "./types";

export interface RangeBounds {
  minRow: number;
  maxRow: number;
  minCol: number;
  maxCol: number;
}

export function normalizeRange(range: CellRange): RangeBounds {
  return {
    minRow: Math.min(range.anchor.row, range.focus.row),
    maxRow: Math.max(range.anchor.row, range.focus.row),
    minCol: Math.min(range.anchor.col, range.focus.col),
    maxCol: Math.max(range.anchor.col, range.focus.col),
  };
}

export function isCellInBounds(address: CellAddress, bounds: RangeBounds): boolean {
  return (
    address.row >= bounds.minRow &&
    address.row <= bounds.maxRow &&
    address.col >= bounds.minCol &&
    address.col <= bounds.maxCol
  );
}

export function singleCellRange(address: CellAddress): CellRange {
  return { anchor: address, focus: address };
}
