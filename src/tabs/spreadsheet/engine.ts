import {
  DetailedCellError,
  HyperFormula,
  type RawCellContent,
  type SimpleCellAddress,
  type SimpleCellRange,
} from "hyperformula";
import { addressKey, parseAddressKey } from "./address";
import { MAX_COLS, MAX_ROWS } from "./constants";
import { applySeries, fillDirection } from "./fill";
import { normalizeCellInput } from "./formulaEdit";
import type { AutoKind } from "./numberFormat";
import type { RangeBounds } from "./range";
import type { CellAddress } from "./types";

// The pure (React-free) wrapper around HyperFormula. Everything the UI needs
// from the formula engine goes through here, in plain strings/numbers, so
// the rest of the app never touches HyperFormula types — and so this can be
// unit-tested without a DOM. useSpreadsheetEngine.ts adapts it to React.

const SHEET_NAME = "Sheet1";

// A cell's raw, persistable content — native JSON types preserved.
export type CellRawValue = string | number | boolean | null;

// How typed dates are read: "1/2/2026" is 2 January in most of the world and
// January 2 in the US. Follows the system locale (like Excel does).
export type DateOrder = "MDY" | "DMY" | "YMD";

const DATE_FORMATS: Record<DateOrder, string[]> = {
  MDY: ["MM/DD/YYYY", "MM/DD/YY", "YYYY/MM/DD"],
  DMY: ["DD/MM/YYYY", "DD/MM/YY", "YYYY/MM/DD"],
  YMD: ["YYYY/MM/DD", "YY/MM/DD"],
};

export function systemDateOrder(): DateOrder {
  try {
    const order = new Intl.DateTimeFormat(undefined)
      .formatToParts(new Date(2026, 10, 22))
      .filter((part) => part.type === "day" || part.type === "month" || part.type === "year")
      .map((part) => part.type[0].toUpperCase())
      .join("");
    if (order === "MDY" || order === "DMY" || order === "YMD") return order;
  } catch {
    // fall through
  }
  return "MDY";
}

// What the grid needs to draw one cell, before any number formatting.
export interface CellView {
  // Unformatted text: "3" for =1+2, "#DIV/0!" for an error, "" when blank.
  text: string;
  // The computed value if (and only if) it is a finite number.
  number: number | null;
  // Human-readable explanation when the cell holds an error.
  error: string | null;
  // What the engine inferred from how the value was typed (a date, a
  // percentage, a currency amount...) — used to display a General cell the
  // way Excel would instead of as a bare serial number.
  auto: AutoKind | null;
}

export interface SheetEngine {
  view(address: CellAddress): CellView;
  // Raw content for the formula bar — "=1+2" for a cell showing 3.
  raw(address: CellAddress): string;
  isEmpty(address: CellAddress): boolean;
  // Every mutator below records exactly one engine undo step.
  setCell(address: CellAddress, rawInput: string): void;
  // Writes a block of raw values with its top-left at `topLeft`; anything
  // that would land outside the grid is dropped. Returns the area written.
  setMatrix(topLeft: CellAddress, values: string[][]): RangeBounds | null;
  clear(bounds: RangeBounds): void;
  // Repeats `source` through `target`, adjusting relative references —
  // what both paste and the fill handle do. With `series` it is a fill
  // (target is a strip beside the source): the pattern carries on from the
  // source, and a run of evenly spaced numbers continues (1, 2 → 3, 4).
  copyInto(source: RangeBounds, target: RangeBounds, series?: boolean): void;
  // Cut-and-paste: moves the cells, keeping formulas that point at them
  // pointing at them. False when the destination doesn't fit.
  move(source: RangeBounds, destination: CellAddress): boolean;
  undo(): boolean;
  redo(): boolean;
  // Sparse map of every non-empty cell's raw content, for persistence.
  exportCells(): Record<string, CellRawValue>;
  functionNames: readonly string[];
}

const SYMBOL_TO_AUTO: Record<string, AutoKind> = { $: "usd", "€": "eur", "£": "gbp" };

// A date serial below this (27 May 1927) is far more likely to be the
// result of subtracting two dates — a number of days — than a real date.
const MIN_AUTO_DATE_SERIAL = 10_000;

const ERROR_MESSAGES: Record<string, string> = {
  "#DIV/0!": "Division by zero",
  "#CYCLE!": "Circular reference: this formula depends on its own cell",
  "#NAME?": "Unknown function or name",
  "#ERROR!": "This formula has a syntax error",
  "#REF!": "Refers to a cell that doesn't exist",
  "#VALUE!": "Wrong type of value for this formula",
  "#N/A": "Value not available",
  "#NUM!": "Invalid number",
};

function explainError(error: DetailedCellError): string {
  const message = error.message;
  // HyperFormula's parser errors are long token dumps; its other messages
  // ("Function name FOO not recognized.") are worth showing as they are.
  if (message && message.length <= 80 && !message.includes("\n") && !message.startsWith("Parsing error")) {
    return message;
  }
  return ERROR_MESSAGES[error.value] ?? "Error";
}

function toCellRawValue(value: RawCellContent): CellRawValue {
  if (value instanceof Date) return value.toISOString();
  if (value === undefined) return null;
  return value;
}

function inGrid(address: CellAddress): boolean {
  return address.row >= 0 && address.col >= 0 && address.row < MAX_ROWS && address.col < MAX_COLS;
}

export function createSheetEngine(
  initialCells: Record<string, CellRawValue> = {},
  dateOrder: DateOrder = systemDateOrder(),
): SheetEngine {
  const hf = HyperFormula.buildEmpty({
    licenseKey: "gpl-v3",
    dateFormats: DATE_FORMATS[dateOrder],
    currencySymbol: ["$", "€", "£"],
  });
  hf.addSheet(SHEET_NAME);
  const sheet = hf.getSheetId(SHEET_NAME) ?? 0;
  // Excel accepts bare TRUE/FALSE inside formulas (=VLOOKUP(…, FALSE));
  // HyperFormula only knows the TRUE()/FALSE() functions.
  hf.addNamedExpression("TRUE", "=TRUE()");
  hf.addNamedExpression("FALSE", "=FALSE()");

  const at = (address: CellAddress): SimpleCellAddress => ({ sheet, row: address.row, col: address.col });
  const range = (bounds: RangeBounds): SimpleCellRange => ({
    start: { sheet, row: bounds.minRow, col: bounds.minCol },
    end: { sheet, row: bounds.maxRow, col: bounds.maxCol },
  });

  // Initial load. Out-of-grid (or corrupt, e.g. "ZZZ99999") addresses are
  // dropped: the array below is sized from the largest address seen.
  const parsed: { address: CellAddress; value: CellRawValue }[] = [];
  let maxRow = -1;
  let maxCol = -1;
  for (const [key, value] of Object.entries(initialCells)) {
    const address = parseAddressKey(key);
    if (!address || !inGrid(address)) continue;
    parsed.push({ address, value });
    maxRow = Math.max(maxRow, address.row);
    maxCol = Math.max(maxCol, address.col);
  }
  if (parsed.length > 0) {
    const grid: RawCellContent[][] = Array.from({ length: maxRow + 1 }, () =>
      Array.from({ length: maxCol + 1 }, () => null),
    );
    for (const { address, value } of parsed) grid[address.row][address.col] = value;
    hf.setSheetContent(sheet, grid);
  }
  // Loading a document (and defining TRUE/FALSE) isn't something to undo.
  hf.clearUndoStack();
  hf.clearRedoStack();

  function view(address: CellAddress): CellView {
    const simple = at(address);
    const value = hf.getCellValue(simple);
    if (value instanceof DetailedCellError) {
      return { text: value.value, number: null, error: explainError(value), auto: null };
    }
    if (value === null || value === undefined) return { text: "", number: null, error: null, auto: null };
    if (typeof value === "boolean") return { text: value ? "TRUE" : "FALSE", number: null, error: null, auto: null };
    if (typeof value !== "number" || !Number.isFinite(value)) {
      return { text: String(value), number: null, error: null, auto: null };
    }
    let auto: AutoKind | null = null;
    switch (hf.getCellValueDetailedType(simple)) {
      case "NUMBER_DATE":
        if (value >= MIN_AUTO_DATE_SERIAL) auto = "date";
        break;
      case "NUMBER_DATETIME":
        if (value >= MIN_AUTO_DATE_SERIAL) auto = "datetime";
        break;
      case "NUMBER_TIME":
        auto = "time";
        break;
      case "NUMBER_PERCENT":
        auto = "percent";
        break;
      case "NUMBER_CURRENCY":
        auto = SYMBOL_TO_AUTO[hf.getCellValueFormat(simple) ?? "$"] ?? "usd";
        break;
    }
    return { text: String(value), number: value, error: null, auto };
  }

  function raw(address: CellAddress): string {
    const serialized = hf.getCellSerialized(at(address));
    return serialized === null || serialized === undefined ? "" : String(serialized);
  }

  function setCell(address: CellAddress, rawInput: string): void {
    hf.setCellContents(at(address), normalizeCellInput(rawInput));
  }

  function setMatrix(topLeft: CellAddress, values: string[][]): RangeBounds | null {
    if (!inGrid(topLeft)) return null;
    const rows = values.slice(0, MAX_ROWS - topLeft.row);
    const width = Math.min(
      MAX_COLS - topLeft.col,
      rows.reduce((widest, row) => Math.max(widest, row.length), 0),
    );
    if (rows.length === 0 || width === 0) return null;
    const matrix: RawCellContent[][] = rows.map((row) =>
      Array.from({ length: width }, (_, col) => {
        const value = row[col] ?? "";
        return value === "" ? null : normalizeCellInput(value);
      }),
    );
    hf.setCellContents(at(topLeft), matrix);
    return {
      minRow: topLeft.row,
      maxRow: topLeft.row + rows.length - 1,
      minCol: topLeft.col,
      maxCol: topLeft.col + width - 1,
    };
  }

  function clear(bounds: RangeBounds): void {
    const matrix: RawCellContent[][] = Array.from({ length: bounds.maxRow - bounds.minRow + 1 }, () =>
      Array.from({ length: bounds.maxCol - bounds.minCol + 1 }, () => null),
    );
    hf.setCellContents({ sheet, row: bounds.minRow, col: bounds.minCol }, matrix);
  }

  function copyInto(source: RangeBounds, target: RangeBounds, series = false): void {
    // A fill continues the source's pattern outward from where it sits; a
    // paste starts the pattern afresh at the target's top-left corner.
    const data = hf.getFillRangeData(range(source), range(target), !series);
    if (series) {
      const direction = fillDirection(source, target);
      if (direction) applySeries(hf.getRangeSerialized(range(source)), data, direction);
    }
    hf.setCellContents({ sheet, row: target.minRow, col: target.minCol }, data);
  }

  function move(source: RangeBounds, destination: CellAddress): boolean {
    const height = source.maxRow - source.minRow;
    const width = source.maxCol - source.minCol;
    if (!inGrid(destination) || !inGrid({ row: destination.row + height, col: destination.col + width })) return false;
    if (!hf.isItPossibleToMoveCells(range(source), at(destination))) return false;
    hf.moveCells(range(source), at(destination));
    return true;
  }

  function undo(): boolean {
    if (!hf.isThereSomethingToUndo()) return false;
    hf.undo();
    return true;
  }

  function redo(): boolean {
    if (!hf.isThereSomethingToRedo()) return false;
    hf.redo();
    return true;
  }

  function exportCells(): Record<string, CellRawValue> {
    const result: Record<string, CellRawValue> = {};
    hf.getSheetSerialized(sheet).forEach((rowValues, row) => {
      rowValues.forEach((value, col) => {
        if (value === null || value === undefined || value === "") return;
        if (!inGrid({ row, col })) return;
        result[addressKey({ row, col })] = toCellRawValue(value);
      });
    });
    return result;
  }

  const functionNames = HyperFormula.getRegisteredFunctionNames("enGB")
    .filter((name) => /^[A-Z][A-Z0-9.]*$/.test(name) && !name.startsWith("HF."))
    .sort();

  return {
    view,
    raw,
    isEmpty: (address) => hf.isCellEmpty(at(address)),
    setCell,
    setMatrix,
    clear,
    copyInto,
    move,
    undo,
    redo,
    exportCells,
    functionNames,
  };
}
