import { addressKey } from "./address";
import type { SheetEngine } from "./engine";
import { formatAutoValue, formatNumberValue, type AutoKind } from "./numberFormat";
import type { CellFormat } from "./types";

// What the grid draws for one non-empty cell.
export interface DisplayCell {
  row: number;
  col: number;
  text: string;
  // Numbers are right-aligned; errors and TRUE/FALSE are centred.
  kind: "text" | "number" | "error" | "boolean";
  // Explanation shown as a tooltip on error cells.
  error: string | null;
  auto: AutoKind | null;
}

export interface SheetView {
  // Sparse: only cells with something to show, keyed by "A1"-style address.
  cells: Record<string, DisplayCell>;
  // Numeric value of every numeric cell, for the selection summary.
  numbers: Record<string, number>;
}

// Computed display values for the whole sheet. Rebuilt only when content or
// formatting changes (not on selection moves or keystrokes in an edit).
export function buildSheetView(
  engine: SheetEngine,
  formats: Record<string, CellFormat>,
  rows: number,
  cols: number,
): SheetView {
  const cells: Record<string, DisplayCell> = {};
  const numbers: Record<string, number> = {};
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const view = engine.view({ row, col });
      if (view.text === "") continue;
      const key = addressKey({ row, col });
      if (view.number === null) {
        const kind = view.error ? "error" : view.text === "TRUE" || view.text === "FALSE" ? "boolean" : "text";
        cells[key] = { row, col, text: view.text, kind, error: view.error, auto: null };
        continue;
      }
      numbers[key] = view.number;
      const format = formats[key];
      const text = format?.numberFormat
        ? formatNumberValue(view.number, format.numberFormat, format.decimals)
        : view.auto
          ? formatAutoValue(view.number, view.auto)
          : view.text;
      cells[key] = { row, col, text, kind: "number", error: null, auto: view.auto };
    }
  }
  return { cells, numbers };
}
