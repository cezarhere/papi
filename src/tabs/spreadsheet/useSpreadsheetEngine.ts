import { useCallback, useState } from "react";
import {
  DetailedCellError,
  ExportedCellChange,
  HyperFormula,
  type ExportedChange,
  type RawCellContent,
  type SimpleCellAddress,
  type SimpleCellRange,
} from "hyperformula";
import { addressKey, parseAddressKey } from "./address";
import { MAX_COLS, MAX_ROWS } from "./constants";
import { normalizeRange, type RangeBounds } from "./range";
import type { CellAddress, CellRange } from "./types";

const SHEET_NAME = "Sheet1";

// A cell's raw, persistable content — native JSON types preserved (numbers
// stay numbers, formulas/text are strings, etc.), unlike getRawInput()
// which coerces everything to a display string.
export type CellRawValue = string | number | boolean | null;

function toCellRawValue(value: RawCellContent): CellRawValue {
  if (value instanceof Date) return value.toISOString();
  if (value === undefined) return null;
  return value;
}

function toSimpleCellAddress(sheet: number, address: CellAddress): SimpleCellAddress {
  return { sheet, row: address.row, col: address.col };
}

function toSimpleCellRange(sheet: number, bounds: RangeBounds): SimpleCellRange {
  return {
    start: { sheet, row: bounds.minRow, col: bounds.minCol },
    end: { sheet, row: bounds.maxRow, col: bounds.maxCol },
  };
}

export interface SpreadsheetEngine {
  // Computed value for the grid — e.g. "3" for a cell containing "=1+2".
  getDisplayValue(address: CellAddress): string;
  // Raw content for the formula bar — e.g. "=1+2" for that same cell.
  getRawInput(address: CellAddress): string;
  setCellContent(address: CellAddress, rawInput: string): void;
  // Stores `range` in HyperFormula's clipboard for a later pasteAt call.
  copyRange(range: CellRange): void;
  // Pastes the previously copied range anchored at `address`, adjusting
  // relative references (and leaving $-absolute ones fixed).
  pasteAt(address: CellAddress): void;
  clearClipboard(): void;
  // Repeats `source`'s content down through `target`, adjusting relative
  // references per destination row — the fill-handle drag operation.
  fillDown(source: CellRange, target: CellRange): void;
  // Clears every cell in `range` as a single undo-able transaction.
  clearRange(range: CellRange): void;
  // Undoes/redoes the last content/formula change. Returns the address of
  // the first affected cell (so the caller can move selection there), or
  // null if there was nothing to undo/redo.
  undo(): CellAddress | null;
  redo(): CellAddress | null;
  canUndo(): boolean;
  canRedo(): boolean;
  // Sparse map of every non-empty cell's raw content, keyed by "A1"-style
  // address — for persistence (save).
  exportCells(): Record<string, CellRawValue>;
  // Replaces the entire sheet with `cells` — for loading a saved file. Not
  // undo-tracked; loading a document resets history.
  importCells(cells: Record<string, CellRawValue>): void;
  // Bumped after every write. HyperFormula's own mutations aren't visible
  // to React, so this is the stable primitive an effect (e.g. autosave)
  // can actually depend on — the engine object itself is a new reference
  // every render, and its methods are stable, so neither changes.
  revision: number;
}

// Owns the HyperFormula instance (created once, kept stable across renders)
// and adapts it to plain string in/out so the rest of the UI never touches
// HyperFormula types directly.
export function useSpreadsheetEngine(): SpreadsheetEngine {
  const [engine] = useState(() => {
    const instance = HyperFormula.buildEmpty({ licenseKey: "gpl-v3" });
    instance.addSheet(SHEET_NAME);
    return instance;
  });
  const sheetId = engine.getSheetId(SHEET_NAME) ?? 0;

  // Bumped after every write so components using this hook re-render and
  // re-read fresh values — HyperFormula's own mutations aren't visible to
  // React on their own. Also exposed as `revision` below.
  const [revision, setRevision] = useState(0);

  const getDisplayValue = useCallback(
    (address: CellAddress): string => {
      const value = engine.getCellValue(toSimpleCellAddress(sheetId, address));
      if (value instanceof DetailedCellError) return value.value;
      if (value === null) return "";
      if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
      return String(value);
    },
    [engine, sheetId],
  );

  const getRawInput = useCallback(
    (address: CellAddress): string => {
      const raw = engine.getCellSerialized(toSimpleCellAddress(sheetId, address));
      return raw === null || raw === undefined ? "" : String(raw);
    },
    [engine, sheetId],
  );

  const setCellContent = useCallback(
    (address: CellAddress, rawInput: string) => {
      engine.setCellContents(toSimpleCellAddress(sheetId, address), rawInput);
      setRevision((n) => n + 1);
    },
    [engine, sheetId],
  );

  const copyRange = useCallback(
    (range: CellRange) => {
      engine.copy(toSimpleCellRange(sheetId, normalizeRange(range)));
    },
    [engine, sheetId],
  );

  const pasteAt = useCallback(
    (address: CellAddress) => {
      if (engine.isClipboardEmpty()) return;
      engine.paste(toSimpleCellAddress(sheetId, address));
      setRevision((n) => n + 1);
    },
    [engine, sheetId],
  );

  const clearClipboard = useCallback(() => {
    engine.clearClipboard();
  }, [engine]);

  const fillDown = useCallback(
    (source: CellRange, target: CellRange) => {
      const sourceSimpleRange = toSimpleCellRange(sheetId, normalizeRange(source));
      const targetSimpleRange = toSimpleCellRange(sheetId, normalizeRange(target));
      const data = engine.getFillRangeData(sourceSimpleRange, targetSimpleRange);
      engine.setCellContents(targetSimpleRange.start, data);
      setRevision((n) => n + 1);
    },
    [engine, sheetId],
  );

  const clearRange = useCallback(
    (range: CellRange) => {
      const bounds = normalizeRange(range);
      engine.batch(() => {
        for (let row = bounds.minRow; row <= bounds.maxRow; row++) {
          for (let col = bounds.minCol; col <= bounds.maxCol; col++) {
            engine.setCellContents(toSimpleCellAddress(sheetId, { row, col }), "");
          }
        }
      });
      setRevision((n) => n + 1);
    },
    [engine, sheetId],
  );

  const firstChangedAddress = (changes: ExportedChange[]): CellAddress | null => {
    const cellChange = changes.find((change) => change instanceof ExportedCellChange);
    return cellChange ? { row: cellChange.row, col: cellChange.col } : null;
  };

  const undo = useCallback(() => {
    if (!engine.isThereSomethingToUndo()) return null;
    const changes = engine.undo();
    setRevision((n) => n + 1);
    return firstChangedAddress(changes);
  }, [engine]);

  const redo = useCallback(() => {
    if (!engine.isThereSomethingToRedo()) return null;
    const changes = engine.redo();
    setRevision((n) => n + 1);
    return firstChangedAddress(changes);
  }, [engine]);

  const canUndo = useCallback(() => engine.isThereSomethingToUndo(), [engine]);
  const canRedo = useCallback(() => engine.isThereSomethingToRedo(), [engine]);

  const exportCells = useCallback((): Record<string, CellRawValue> => {
    const grid = engine.getSheetSerialized(sheetId);
    const result: Record<string, CellRawValue> = {};
    grid.forEach((rowValues, row) => {
      rowValues.forEach((value, col) => {
        if (value === null || value === undefined || value === "") return;
        result[addressKey({ row, col })] = toCellRawValue(value);
      });
    });
    return result;
  }, [engine, sheetId]);

  const importCells = useCallback(
    (cells: Record<string, CellRawValue>) => {
      let maxRow = 0;
      let maxCol = 0;
      const parsed: { address: CellAddress; value: CellRawValue }[] = [];
      for (const [key, value] of Object.entries(cells)) {
        const address = parseAddressKey(key);
        // Out-of-grid (or corrupt, e.g. "ZZZ99999") addresses are dropped:
        // the grid below is sized from the largest address seen, so an
        // unbounded one would allocate an enormous array.
        if (!address || address.row < 0 || address.col < 0) continue;
        if (address.row >= MAX_ROWS || address.col >= MAX_COLS) continue;
        parsed.push({ address, value });
        maxRow = Math.max(maxRow, address.row);
        maxCol = Math.max(maxCol, address.col);
      }
      const grid: RawCellContent[][] = Array.from({ length: maxRow + 1 }, () =>
        Array.from({ length: maxCol + 1 }, () => null),
      );
      for (const { address, value } of parsed) {
        grid[address.row][address.col] = value;
      }
      engine.setSheetContent(sheetId, grid);
      engine.clearUndoStack();
      engine.clearRedoStack();
      setRevision((n) => n + 1);
    },
    [engine, sheetId],
  );

  return {
    getDisplayValue,
    getRawInput,
    setCellContent,
    copyRange,
    pasteAt,
    undo,
    redo,
    canUndo,
    canRedo,
    clearClipboard,
    fillDown,
    clearRange,
    exportCells,
    importCells,
    revision,
  };
}
