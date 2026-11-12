import { addressKey, parseAddressKey } from "./address";
import type { RangeBounds } from "./range";
import type { CellAddress, CellFormat } from "./types";

// Pure helpers for the operations that rearrange the sheet: inserting and
// deleting rows/columns (formats and column widths have to move with the
// cells — the formula engine only moves content), sorting, and AutoSum.

// Formats after inserting (`delta` > 0) or deleting (`delta` < 0) rows or
// columns at `index`: everything from there on shifts by `delta`; formats
// on deleted lines, or pushed outside the grid, are dropped.
export function shiftFormats(
  formats: Record<string, CellFormat>,
  axis: "row" | "col",
  index: number,
  delta: number,
  rows: number,
  cols: number,
): Record<string, CellFormat> {
  const next: Record<string, CellFormat> = {};
  for (const [key, format] of Object.entries(formats)) {
    const address = parseAddressKey(key);
    if (!address) continue;
    const position = address[axis];
    let moved = position;
    if (delta > 0) {
      if (position >= index) moved = position + delta;
    } else if (position >= index - delta) {
      moved = position + delta;
    } else if (position >= index) {
      continue; // on a deleted line
    }
    const target: CellAddress = axis === "row" ? { row: moved, col: address.col } : { row: address.row, col: moved };
    if (target.row >= rows || target.col >= cols) continue;
    next[addressKey(target)] = format;
  }
  return next;
}

// Column widths (keyed by column index) after inserting/deleting columns.
export function shiftWidths(
  widths: Record<string, number>,
  index: number,
  delta: number,
  cols: number,
): Record<string, number> {
  const next: Record<string, number> = {};
  for (const [key, width] of Object.entries(widths)) {
    const col = Number(key);
    let moved = col;
    if (delta > 0) {
      if (col >= index) moved = col + delta;
    } else if (col >= index - delta) {
      moved = col + delta;
    } else if (col >= index) {
      continue;
    }
    if (moved < cols) next[String(moved)] = width;
  }
  return next;
}

// What a cell sorts by: a number, text, or nothing (blank).
export type SortKey = number | string | null;

// The row order for a sort: numbers first (by value), then text (A→Z,
// ignoring case, digits compared as numbers), blanks always last — in both
// directions, like Excel. Stable: rows that compare equal keep their order.
export function sortOrder(keys: SortKey[], descending: boolean): number[] {
  const rank = (key: SortKey) => (key === null ? 2 : typeof key === "number" ? 0 : 1);
  const direction = descending ? -1 : 1;
  return keys
    .map((key, index) => ({ key, index }))
    .sort((a, b) => {
      const ra = rank(a.key);
      const rb = rank(b.key);
      if (ra === 2 || rb === 2) return ra - rb || a.index - b.index;
      let compared: number;
      if (ra !== rb) compared = ra - rb;
      else if (typeof a.key === "number") compared = a.key - (b.key as number);
      else compared = (a.key as string).localeCompare(b.key as string, undefined, { numeric: true, sensitivity: "base" });
      return compared * direction || a.index - b.index;
    })
    .map((entry) => entry.index);
}

// A first row of text above a column that goes on to hold numbers is a
// header: it stays put while the rows under it are sorted.
export function hasHeaderRow(keys: SortKey[]): boolean {
  if (keys.length < 2 || typeof keys[0] !== "string") return false;
  return keys.slice(1).some((key) => typeof key === "number");
}

// The block of data around a cell: grown outward for as long as the row or
// column just beyond it has anything in it (Excel's "current region").
export function currentRegion(
  isEmpty: (address: CellAddress) => boolean,
  from: CellAddress,
  rows: number,
  cols: number,
): RangeBounds {
  const region: RangeBounds = { minRow: from.row, maxRow: from.row, minCol: from.col, maxCol: from.col };
  const rowHasData = (row: number) => {
    for (let col = Math.max(0, region.minCol - 1); col <= Math.min(cols - 1, region.maxCol + 1); col++) {
      if (!isEmpty({ row, col })) return true;
    }
    return false;
  };
  const colHasData = (col: number) => {
    for (let row = Math.max(0, region.minRow - 1); row <= Math.min(rows - 1, region.maxRow + 1); row++) {
      if (!isEmpty({ row, col })) return true;
    }
    return false;
  };
  let grew = true;
  while (grew) {
    grew = false;
    if (region.minRow > 0 && rowHasData(region.minRow - 1)) (region.minRow--, (grew = true));
    if (region.maxRow < rows - 1 && rowHasData(region.maxRow + 1)) (region.maxRow++, (grew = true));
    if (region.minCol > 0 && colHasData(region.minCol - 1)) (region.minCol--, (grew = true));
    if (region.maxCol < cols - 1 && colHasData(region.maxCol + 1)) (region.maxCol++, (grew = true));
  }
  return region;
}

// AutoSum on a single cell: the run of numbers directly above it, or
// failing that directly to its left — what the total most likely covers.
export function autoSumRange(isNumber: (address: CellAddress) => boolean, cell: CellAddress): RangeBounds | null {
  let row = cell.row - 1;
  while (row >= 0 && isNumber({ row, col: cell.col })) row--;
  if (row < cell.row - 1) return { minRow: row + 1, maxRow: cell.row - 1, minCol: cell.col, maxCol: cell.col };
  let col = cell.col - 1;
  while (col >= 0 && isNumber({ row: cell.row, col })) col--;
  if (col < cell.col - 1) return { minRow: cell.row, maxRow: cell.row, minCol: col + 1, maxCol: cell.col - 1 };
  return null;
}
