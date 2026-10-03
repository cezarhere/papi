import { parseAddressKey } from "./address";
import type { RangeBounds } from "./range";

// Finds the cell/range references in a formula being edited (A1, $B$2,
// C3:D9) so the grid can outline them for as long as the formula is open —
// what Excel does. Text inside "string literals" is ignored, as are
// function names that happen to look like cells (LOG10(, ATAN2( ...).
// References outside the grid are dropped.
const REF_PATTERN = /(?<![A-Za-z0-9_.$])\$?([A-Za-z]{1,2})\$?(\d{1,3})(?::\$?([A-Za-z]{1,2})\$?(\d{1,3}))?(?![A-Za-z0-9_(])/g;

export function parseFormulaRefs(formula: string, maxRows: number, maxCols: number): RangeBounds[] {
  if (!formula.startsWith("=")) return [];
  // Blank out string literals (same length, so indices stay valid).
  const text = formula.replace(/"[^"]*"?/g, (m) => " ".repeat(m.length));
  const refs: RangeBounds[] = [];
  for (const match of text.matchAll(REF_PATTERN)) {
    const [, colA, rowA, colB, rowB] = match;
    const start = parseAddressKey(`${colA}${rowA}`);
    const end = colB !== undefined ? parseAddressKey(`${colB}${rowB}`) : start;
    if (!start || !end) continue;
    const bounds: RangeBounds = {
      minRow: Math.min(start.row, end.row),
      maxRow: Math.max(start.row, end.row),
      minCol: Math.min(start.col, end.col),
      maxCol: Math.max(start.col, end.col),
    };
    if (bounds.minRow < 0 || bounds.minCol < 0 || bounds.maxRow >= maxRows || bounds.maxCol >= maxCols) continue;
    refs.push(bounds);
  }
  return refs;
}

export interface RefEdges {
  top: boolean;
  right: boolean;
  bottom: boolean;
  left: boolean;
}

// Which sides of this cell lie on the outer edge of a referenced range —
// so an A1:B3 reference is drawn as one rectangle around the block (no
// lines between its inner cells), and adjacent cells share one outline.
// Null when the cell isn't part of any reference.
export function refEdgesForCell(row: number, col: number, refs: RangeBounds[]): RefEdges | null {
  let edges: RefEdges | null = null;
  for (const r of refs) {
    if (row < r.minRow || row > r.maxRow || col < r.minCol || col > r.maxCol) continue;
    edges ??= { top: false, right: false, bottom: false, left: false };
    if (row === r.minRow) edges.top = true;
    if (row === r.maxRow) edges.bottom = true;
    if (col === r.minCol) edges.left = true;
    if (col === r.maxCol) edges.right = true;
  }
  return edges;
}
