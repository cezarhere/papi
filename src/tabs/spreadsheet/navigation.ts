import type { CellAddress } from "./types";

// Cmd+Arrow, as in Excel: from a filled cell whose neighbour is also filled,
// jump to the end of that run; otherwise jump to the next filled cell; with
// nothing ahead, go to the edge of the grid.
export function jumpTarget(
  isEmpty: (address: CellAddress) => boolean,
  from: CellAddress,
  deltaRow: number,
  deltaCol: number,
  rows: number,
  cols: number,
): CellAddress {
  const inside = (a: CellAddress) => a.row >= 0 && a.col >= 0 && a.row < rows && a.col < cols;
  const step = (a: CellAddress): CellAddress => ({ row: a.row + deltaRow, col: a.col + deltaCol });

  let current = from;
  let next = step(current);
  if (!inside(next)) return from;

  if (!isEmpty(current) && !isEmpty(next)) {
    while (inside(step(current)) && !isEmpty(step(current))) current = step(current);
    return current;
  }
  current = next;
  while (isEmpty(current)) {
    next = step(current);
    if (!inside(next)) return current;
    current = next;
  }
  return current;
}

// The bottom-right corner of everything that has content (Cmd+End).
export function lastUsedCell(isEmpty: (address: CellAddress) => boolean, rows: number, cols: number): CellAddress {
  let maxRow = 0;
  let maxCol = 0;
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      if (isEmpty({ row, col })) continue;
      maxRow = Math.max(maxRow, row);
      maxCol = Math.max(maxCol, col);
    }
  }
  return { row: maxRow, col: maxCol };
}
