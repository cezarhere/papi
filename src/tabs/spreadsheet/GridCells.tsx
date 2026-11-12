import { memo, useMemo } from "react";
import { addressKey, parseAddressKey } from "./address";
import type { Geometry } from "./geometry";
import type { DisplayCell } from "./sheetView";
import type { CellFormat } from "./types";

// Horizontal room a cell's text doesn't get: 2 x 5px padding + the grid line.
const CELL_INSET = 11;

interface GridCellsProps {
  cells: Record<string, DisplayCell>;
  formats: Record<string, CellFormat>;
  geometry: Geometry;
  cols: number;
  // CSS font of the grid ("13px -apple-system, …"), for measuring text. Null
  // until the grid has mounted and its computed style can be read.
  font: { size: string; family: string } | null;
}

let measureContext: CanvasRenderingContext2D | null | undefined;
const measureCache = new Map<string, number>();

function measureText(text: string, font: string): number {
  const cacheKey = `${font}|${text}`;
  const cached = measureCache.get(cacheKey);
  if (cached !== undefined) return cached;
  if (measureContext === undefined) measureContext = document.createElement("canvas").getContext("2d");
  if (!measureContext) return 0;
  measureContext.font = font;
  const width = measureContext.measureText(text).width;
  if (measureCache.size > 4000) measureCache.clear();
  measureCache.set(cacheKey, width);
  return width;
}

interface PlacedCell {
  key: string;
  row: number;
  col: number;
  span: number;
  text: string;
  kind: DisplayCell["kind"] | "empty";
  error: string | null;
  format: CellFormat | undefined;
}

// The cells themselves: only those with content or a fill colour are in the
// DOM (grid lines are drawn separately), and this only re-renders when
// content, formatting or column widths change — never for selection moves,
// drags or keystrokes in an edit.
function GridCells({ cells, formats, geometry, cols, font }: GridCellsProps) {
  const placed = useMemo(() => {
    const result: PlacedCell[] = [];
    const widthOf = (col: number) => geometry.colLeft[col + 1] - geometry.colLeft[col];

    for (const [key, cell] of Object.entries(cells)) {
      const format = formats[key];
      let span = 1;
      let text = cell.text;
      if (font && (cell.kind === "text" || cell.kind === "number")) {
        const css = `${format?.italic ? "italic " : ""}${format?.bold ? "600 " : ""}${font.size} ${font.family}`;
        const needed = measureText(text, css);
        let room = widthOf(cell.col) - CELL_INSET;
        if (needed > room && cell.kind === "text") {
          // Excel-style spill: long text runs on across empty neighbours.
          let next = cell.col + 1;
          while (needed > room && next < cols) {
            const nextKey = addressKey({ row: cell.row, col: next });
            if (cells[nextKey] || formats[nextKey]?.fill) break;
            room += widthOf(next);
            span++;
            next++;
          }
        } else if (needed > room) {
          // A number that doesn't fit is never shown cut short (a truncated
          // figure reads as a different, wrong one) — hashes, like Excel.
          const hash = measureText("#", css) || 8;
          text = "#".repeat(Math.max(1, Math.floor(room / hash)));
        }
      }
      result.push({ key, row: cell.row, col: cell.col, span, text, kind: cell.kind, error: cell.error, format });
    }

    // Cells that are only a fill colour, with nothing in them.
    for (const [key, format] of Object.entries(formats)) {
      if (!format.fill || cells[key]) continue;
      const address = parseAddressKey(key);
      if (!address) continue;
      result.push({ key, row: address.row, col: address.col, span: 1, text: "", kind: "empty", error: null, format });
    }
    return result;
  }, [cells, formats, geometry, cols, font]);

  return (
    <>
      {placed.map((cell) => {
        const classNames = ["cell", `cell-${cell.kind}`];
        if (cell.span > 1) classNames.push("cell-spill");
        if (cell.format?.bold) classNames.push("cell-bold");
        if (cell.format?.italic) classNames.push("cell-italic");
        if (cell.format?.fill) classNames.push("cell-filled");
        if (cell.format?.align) classNames.push(`cell-align-${cell.format.align}`);
        return (
          <div
            key={cell.key}
            className={classNames.join(" ")}
            style={{
              gridRow: cell.row + 2,
              gridColumn: cell.span > 1 ? `${cell.col + 2} / span ${cell.span}` : cell.col + 2,
              backgroundColor: cell.format?.fill,
            }}
            title={cell.error ?? undefined}
          >
            {cell.text}
          </div>
        );
      })}
    </>
  );
}

export default memo(GridCells);
