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

export type FillDirection = "down" | "up" | "right" | "left";

// Which way `target` extends `source` — null when it isn't a strip directly
// beside it (a paste somewhere else, which never continues a series).
export function fillDirection(source: RangeBounds, target: RangeBounds): FillDirection | null {
  const sameCols = target.minCol === source.minCol && target.maxCol === source.maxCol;
  const sameRows = target.minRow === source.minRow && target.maxRow === source.maxRow;
  if (sameCols && target.minRow === source.maxRow + 1) return "down";
  if (sameCols && target.maxRow === source.minRow - 1) return "up";
  if (sameRows && target.minCol === source.maxCol + 1) return "right";
  if (sameRows && target.maxCol === source.minCol - 1) return "left";
  return null;
}

function plainNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed === "" || !/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(trimmed)) return null;
  return Number(trimmed);
}

// The constant step of an evenly spaced run of two or more plain numbers
// (1, 2, 3 → 1; 10, 20 → 10), or null when the run isn't one.
function seriesStep(values: unknown[]): { first: number; last: number; step: number } | null {
  if (values.length < 2) return null;
  const numbers: number[] = [];
  for (const value of values) {
    const n = plainNumber(value);
    if (n === null) return null;
    numbers.push(n);
  }
  const step = numbers[1] - numbers[0];
  for (let i = 2; i < numbers.length; i++) {
    if (Math.abs(numbers[i] - numbers[i - 1] - step) > 1e-9 * Math.max(1, Math.abs(step))) return null;
  }
  return { first: numbers[0], last: numbers[numbers.length - 1], step };
}

const tidy = (n: number): number => Number(n.toPrecision(12));

// Excel's series fill: where a column (or row, for a sideways fill) of the
// source holds evenly spaced plain numbers, overwrite the engine's
// repeat-the-pattern `data` for that line with the continued series. A
// single number, text and formulas are left to repeat as they are.
export function applySeries(source: unknown[][], data: unknown[][], direction: FillDirection): void {
  const height = data.length;
  const width = data[0]?.length ?? 0;
  if (direction === "down" || direction === "up") {
    for (let col = 0; col < width; col++) {
      const series = seriesStep(source.map((row) => row[col]));
      if (!series) continue;
      for (let row = 0; row < height; row++) {
        data[row][col] =
          direction === "down"
            ? tidy(series.last + series.step * (row + 1))
            : tidy(series.first - series.step * (height - row));
      }
    }
    return;
  }
  for (let row = 0; row < height; row++) {
    const series = seriesStep(source[row] ?? []);
    if (!series) continue;
    for (let col = 0; col < width; col++) {
      data[row][col] =
        direction === "right"
          ? tidy(series.last + series.step * (col + 1))
          : tidy(series.first - series.step * (width - col));
    }
  }
}
