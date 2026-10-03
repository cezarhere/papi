import { normalizeRange } from "./range";
import type { CellAddress, CellRange } from "./types";
import { columnLabel } from "./utils";

// "A1"-style key used to store/look up a cell's content.
export function addressKey(address: CellAddress): string {
  return `${columnLabel(address.col)}${address.row + 1}`;
}

// Inverse of addressKey — "A1" -> {row: 0, col: 0}. Used when reading a
// saved file's sparse cell/format maps back into addresses.
export function parseAddressKey(key: string): CellAddress | null {
  const match = /^([A-Za-z]+)(\d+)$/.exec(key);
  if (!match) return null;
  const [, colPart, rowPart] = match;
  let col = 0;
  for (const char of colPart.toUpperCase()) {
    col = col * 26 + (char.charCodeAt(0) - 64);
  }
  return { row: parseInt(rowPart, 10) - 1, col: col - 1 };
}

// "A1" for a single cell, "A1:B3" for a range — what gets inserted into a
// formula when picking cells while editing.
export function formatRangeReference(range: CellRange): string {
  const bounds = normalizeRange(range);
  const start = `${columnLabel(bounds.minCol)}${bounds.minRow + 1}`;
  if (bounds.minRow === bounds.maxRow && bounds.minCol === bounds.maxCol) return start;
  const end = `${columnLabel(bounds.maxCol)}${bounds.maxRow + 1}`;
  return `${start}:${end}`;
}
