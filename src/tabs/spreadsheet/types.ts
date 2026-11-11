import type { NumberFormat } from "./numberFormat";

export interface CellAddress {
  row: number;
  col: number;
}

export interface EditingState {
  address: CellAddress;
  value: string;
  // Which input the edit was started from — the grid cell's own inline
  // editor always renders while editing (so the cell stays live-in-sync
  // with the formula bar), but only the "cell" source should steal DOM
  // focus to it; "formula-bar" means the user is typing there instead.
  source: "cell" | "formula-bar";
  // Excel's two edit modes. "enter": started by typing over the cell —
  // arrow keys commit and move on (or, in a formula, pick cells). "edit":
  // started by double-click / F2 / the formula bar — arrow keys move the
  // caret within the text.
  mode: "enter" | "edit";
  // Caret position in `value`, tracked so function autocomplete knows
  // which word is being typed.
  caret: number;
}

// A selected range, defined by where the drag/click started (anchor) and
// where it currently ends (focus). Equal corners mean a single-cell
// selection. The active cell for editing/formula-bar purposes is always
// the anchor.
export interface CellRange {
  anchor: CellAddress;
  focus: CellAddress;
}

// Formatting lives outside HyperFormula (see SPEC.md's architecture
// decisions) — it's a headless calc engine with no concept of styling.
export interface CellFormat {
  bold?: boolean;
  italic?: boolean;
  fill?: string;
  // Display-only: how a *numeric* result is shown (the engine keeps the
  // raw number). Undefined means "General" — shown as the engine returns it.
  numberFormat?: NumberFormat;
  // Fixed decimal places; undefined uses the format's default.
  decimals?: number;
}
