import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";
import { addressKey, formatRangeReference, parseAddressKey } from "./spreadsheet/address";
import { parseCsv, toCsv } from "./spreadsheet/csv";
import { COL_HEADER_HEIGHT, MAX_COLS, MAX_ROWS, ROW_HEADER_WIDTH } from "./spreadsheet/constants";
import FormulaBar from "./spreadsheet/FormulaBar";
import Grid from "./spreadsheet/Grid";
import { buildDocument, loadDocumentFromStorage, saveDocumentToStorage } from "./spreadsheet/persistence";
import { normalizeRange, type RangeBounds } from "./spreadsheet/range";
import "./spreadsheet/SpreadsheetTab.css";
import Toolbar from "./spreadsheet/Toolbar";
import type { CellAddress, CellFormat, CellRange, EditingState } from "./spreadsheet/types";
import { useCellFormatting, type FormatSnapshot } from "./spreadsheet/useCellFormatting";
import { useSpreadsheetEngine } from "./spreadsheet/useSpreadsheetEngine";
import { clamp } from "./spreadsheet/utils";

const rows = MAX_ROWS;
const cols = MAX_COLS;

type DragMode = "select" | "fill" | "formula-ref" | null;

// Tracks the substring of the formula currently occupied by a picked
// reference, so dragging over more cells can replace it in place instead
// of appending endlessly.
interface FormulaRefDrag {
  anchor: CellAddress;
  focus: CellAddress;
  insertStart: number;
  insertEnd: number;
}

// A unified undo/redo stack covering both content/formula changes and
// formatting changes. Content entries carry no data — HyperFormula already
// tracks the actual before/after internally, so the entry is just a marker
// telling undo/redo to call engine.undo()/redo() for that slot. Format
// entries carry a full before/after snapshot, since formatting has no
// engine of its own to ask.
type HistoryEntry =
  | { type: "content" }
  | { type: "format"; before: FormatSnapshot; after: FormatSnapshot };

interface HistoryState {
  entries: HistoryEntry[];
  index: number;
}

function isFormula(value: string): boolean {
  return value.startsWith("=");
}

const AUTOSAVE_DEBOUNCE_MS = 500;
const MAX_IMPORT_BYTES = 2 * 1024 * 1024;

export default function SpreadsheetTab() {
  const containerRef = useRef<HTMLDivElement>(null);
  const engine = useSpreadsheetEngine();
  const formatting = useCellFormatting();
  const editingInputRef = useRef<HTMLInputElement>(null);
  const [selection, setSelection] = useState<CellRange>({
    anchor: { row: 0, col: 0 },
    focus: { row: 0, col: 0 },
  });
  const [editing, setEditing] = useState<EditingState | null>(null);
  const [dragMode, setDragMode] = useState<DragMode>(null);
  // Row the fill preview currently extends to, while dragging the fill handle.
  const [fillPreviewEndRow, setFillPreviewEndRow] = useState<number | null>(null);
  // Range with the dashed "copied" outline. Purely visual — HyperFormula
  // owns the actual clipboard contents.
  const [copiedRange, setCopiedRange] = useState<CellRange | null>(null);
  // In-progress reference pick while editing a formula (click/drag a cell
  // to insert its address at the caret).
  const [formulaRefDrag, setFormulaRefDrag] = useState<FormulaRefDrag | null>(null);
  // Set right after a formula-ref insertion so an effect can move the
  // input's actual caret there once the new value has been committed.
  const [pendingCaret, setPendingCaret] = useState<number | null>(null);
  const [historyState, setHistoryState] = useState<HistoryState>({ entries: [], index: 0 });

  const activeCell = selection.anchor;
  const selectionBounds = normalizeRange(selection);

  // Restores the last autosaved document once on mount, before the
  // autosave effect below gets a chance to run — hasHydratedRef guards
  // against that effect writing empty state back out first.
  const hasHydratedRef = useRef(false);
  useEffect(() => {
    const saved = loadDocumentFromStorage();
    if (saved) {
      engine.importCells(saved.cells);
      formatting.replaceAll(saved.formats);
    }
    hasHydratedRef.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Autosaves to localStorage (CALC_SPEC.md "Autosave"), debounced so a
  // burst of keystrokes/edits doesn't write on every single one; flushed
  // immediately on window hide / app quit / unload so the last edits
  // aren't lost to the debounce interval.
  const savePendingRef = useRef(false);
  const flushSave = useCallback(() => {
    if (!savePendingRef.current) return;
    savePendingRef.current = false;
    saveDocumentToStorage(buildDocument(exportCellsRef.current(), formattingRef.current));
  }, []);
  const formattingRef = useRef(formatting.formats);
  formattingRef.current = formatting.formats;
  const exportCellsRef = useRef(engine.exportCells);
  exportCellsRef.current = engine.exportCells;

  useEffect(() => {
    if (!hasHydratedRef.current) return;
    savePendingRef.current = true;
    const timeoutId = window.setTimeout(flushSave, AUTOSAVE_DEBOUNCE_MS);
    return () => window.clearTimeout(timeoutId);
  }, [engine.revision, formatting.formats, flushSave]);

  useEffect(() => {
    window.addEventListener("beforeunload", flushSave);
    window.addEventListener("pagehide", flushSave);
    const unsubscribe = window.electronAPI?.onWindowHiding(flushSave);
    return () => {
      window.removeEventListener("beforeunload", flushSave);
      window.removeEventListener("pagehide", flushSave);
      unsubscribe?.();
      flushSave();
    };
  }, [flushSave]);

  // Focus the grid on mount, and whenever an edit ends, so arrow keys keep
  // working — committing/canceling unmounts the cell's <input>, which would
  // otherwise drop focus to the document body.
  useEffect(() => {
    if (!editing) containerRef.current?.focus();
  }, [editing, containerRef]);

  // Scroll the active cell into view on keyboard nav — the grid is now
  // always rendered at full size (25x7) rather than clamped to fit the
  // viewport, so most of it can be scrolled out of sight. Measures actual
  // rendered rects (rather than hand-computing from CELL_WIDTH/HEIGHT,
  // which ignores .grid-area's padding) and insets by the sticky header
  // sizes so a cell can't end up parked behind them.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const cellEl = container.querySelector<HTMLElement>(`[data-address="${addressKey(activeCell)}"]`);
    if (!cellEl) return;

    const cellRect = cellEl.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();
    const visibleLeft = containerRect.left + ROW_HEADER_WIDTH;
    const visibleTop = containerRect.top + COL_HEADER_HEIGHT;

    if (cellRect.left < visibleLeft) {
      container.scrollLeft -= visibleLeft - cellRect.left;
    } else if (cellRect.right > containerRect.right) {
      container.scrollLeft += cellRect.right - containerRect.right;
    }

    if (cellRect.top < visibleTop) {
      container.scrollTop -= visibleTop - cellRect.top;
    } else if (cellRect.bottom > containerRect.bottom) {
      container.scrollTop += cellRect.bottom - containerRect.bottom;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeCell.row, activeCell.col, containerRef]);

  // After a formula-ref insertion, move the input's caret to just past the
  // inserted reference once the new value has actually landed in the DOM.
  useEffect(() => {
    if (pendingCaret === null) return;
    const input = editingInputRef.current;
    if (input) {
      input.focus();
      input.setSelectionRange(pendingCaret, pendingCaret);
    }
    setPendingCaret(null);
  }, [pendingCaret]);

  // Finalize a fill, select, or formula-ref drag on mouseup, wherever it
  // happens to land — the drag can end outside any cell, so this can't be
  // a per-cell handler.
  useEffect(() => {
    if (!dragMode) return;

    function handleMouseUp() {
      if (dragMode === "fill" && fillPreviewEndRow !== null) {
        commitFill(fillPreviewEndRow);
      }
      if (dragMode === "formula-ref") {
        setFormulaRefDrag(null);
      }
      setDragMode(null);
      setFillPreviewEndRow(null);
    }

    window.addEventListener("mouseup", handleMouseUp);
    return () => window.removeEventListener("mouseup", handleMouseUp);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dragMode, fillPreviewEndRow, selection]);

  // Records one undo-able action. Called right after every content mutation
  // (as a bare "content" marker — HyperFormula owns the actual before/after)
  // and after every formatting change (with a before/after snapshot).
  function pushHistory(entry: HistoryEntry) {
    setHistoryState((prev) => ({
      entries: [...prev.entries.slice(0, prev.index), entry],
      index: prev.index + 1,
    }));
  }

  function performUndo() {
    if (historyState.index === 0) return;
    const entry = historyState.entries[historyState.index - 1];
    if (entry.type === "content") {
      const address = engine.undo();
      if (address) setSelection({ anchor: address, focus: address });
    } else {
      formatting.restore(entry.before);
    }
    setHistoryState((prev) => ({ ...prev, index: prev.index - 1 }));
  }

  function performRedo() {
    if (historyState.index >= historyState.entries.length) return;
    const entry = historyState.entries[historyState.index];
    if (entry.type === "content") {
      const address = engine.redo();
      if (address) setSelection({ anchor: address, focus: address });
    } else {
      formatting.restore(entry.after);
    }
    setHistoryState((prev) => ({ ...prev, index: prev.index + 1 }));
  }

  function moveSelection(deltaRow: number, deltaCol: number) {
    setSelection((prev) => {
      const next = {
        row: clamp(prev.anchor.row + deltaRow, 0, rows - 1),
        col: clamp(prev.anchor.col + deltaCol, 0, cols - 1),
      };
      return { anchor: next, focus: next };
    });
  }

  function selectedAddresses(): CellAddress[] {
    const addresses: CellAddress[] = [];
    for (let row = selectionBounds.minRow; row <= selectionBounds.maxRow; row++) {
      for (let col = selectionBounds.minCol; col <= selectionBounds.maxCol; col++) {
        addresses.push({ row, col });
      }
    }
    return addresses;
  }

  function commitEdit(moveDir: "right" | "down" | null) {
    if (!editing) return;
    engine.setCellContent(editing.address, editing.value);
    pushHistory({ type: "content" });
    setEditing(null);
    if (moveDir === "right") moveSelection(0, 1);
    if (moveDir === "down") moveSelection(1, 0);
  }

  function cancelEdit() {
    setEditing(null);
    if (dragMode === "formula-ref") {
      setDragMode(null);
      setFormulaRefDrag(null);
    }
  }

  function commitFill(endRow: number) {
    if (endRow <= selectionBounds.maxRow) return;
    const source: CellRange = {
      anchor: { row: selectionBounds.minRow, col: selectionBounds.minCol },
      focus: { row: selectionBounds.maxRow, col: selectionBounds.maxCol },
    };
    const target: CellRange = {
      anchor: { row: selectionBounds.maxRow + 1, col: selectionBounds.minCol },
      focus: { row: endRow, col: selectionBounds.maxCol },
    };
    engine.fillDown(source, target);
    pushHistory({ type: "content" });
    setSelection({
      anchor: { row: selectionBounds.minRow, col: selectionBounds.minCol },
      focus: { row: endRow, col: selectionBounds.maxCol },
    });
  }

  function applyToggle(property: "bold" | "italic") {
    const addresses = selectedAddresses();
    const allSet = addresses.every((address) => formatting.getFormat(address)[property] === true);
    const { before, after } = formatting.applyFormat(addresses, (current) => ({
      ...current,
      [property]: allSet ? undefined : true,
    }));
    pushHistory({ type: "format", before, after });
  }

  function handleSetFill(color: string) {
    const addresses = selectedAddresses();
    const allSameFill = addresses.every((address) => formatting.getFormat(address).fill === color);
    const { before, after } = formatting.applyFormat(addresses, (current) => ({
      ...current,
      fill: allSameFill ? undefined : color,
    }));
    pushHistory({ type: "format", before, after });
  }

  // Inserts `address`'s reference into the formula being edited, at the
  // input's current caret position, and starts tracking a drag so the
  // reference can grow into a range as the mouse moves.
  function startFormulaRefPick(address: CellAddress) {
    if (!editing) return;
    const caret = editingInputRef.current?.selectionStart ?? editing.value.length;
    const refText = addressKey(address);
    const newValue = editing.value.slice(0, caret) + refText + editing.value.slice(caret);
    const insertEnd = caret + refText.length;
    setEditing({ ...editing, value: newValue });
    setFormulaRefDrag({ anchor: address, focus: address, insertStart: caret, insertEnd });
    setDragMode("formula-ref");
    setPendingCaret(insertEnd);
  }

  function handleCellMouseDown(address: CellAddress, e: MouseEvent) {
    if (editing) {
      const isSameCell = editing.address.row === address.row && editing.address.col === address.col;
      if (isSameCell) return; // clicking inside the input being edited — let it handle the click
      if (isFormula(editing.value)) {
        e.preventDefault();
        startFormulaRefPick(address);
        return;
      }
      commitEdit(null);
    }
    setSelection({ anchor: address, focus: address });
    setDragMode("select");
    setCopiedRange(null);
    containerRef.current?.focus();
  }

  function handleCellMouseEnter(address: CellAddress) {
    if (dragMode === "select") {
      setSelection((prev) => ({ ...prev, focus: address }));
    } else if (dragMode === "fill") {
      setFillPreviewEndRow(clamp(address.row, selectionBounds.maxRow, rows - 1));
    } else if (dragMode === "formula-ref" && formulaRefDrag && editing) {
      const refText = formatRangeReference({ anchor: formulaRefDrag.anchor, focus: address });
      const newValue =
        editing.value.slice(0, formulaRefDrag.insertStart) +
        refText +
        editing.value.slice(formulaRefDrag.insertEnd);
      const insertEnd = formulaRefDrag.insertStart + refText.length;
      setEditing({ ...editing, value: newValue });
      setFormulaRefDrag({ ...formulaRefDrag, focus: address, insertEnd });
      setPendingCaret(insertEnd);
    }
  }

  function handleFillHandleMouseDown(e: MouseEvent) {
    e.stopPropagation();
    e.preventDefault();
    setDragMode("fill");
    setFillPreviewEndRow(selectionBounds.maxRow);
  }

  function handleDoubleClick(address: CellAddress) {
    if (editing && editing.address.row === address.row && editing.address.col === address.col) {
      return;
    }
    setSelection({ anchor: address, focus: address });
    setEditing({ address, value: engine.getRawInput(address), source: "cell" });
  }

  function handleEditValueChange(value: string) {
    setEditing((prev) => (prev ? { ...prev, value } : prev));
  }

  // Starting an edit from the formula bar (vs. double-click/typing on the
  // cell) is what makes Cell.tsx *not* steal DOM focus back to the grid —
  // see EditingState's `source`.
  function handleFormulaBarFocus() {
    if (!editing) {
      setEditing({ address: activeCell, value: engine.getRawInput(activeCell), source: "formula-bar" });
    }
  }

  function handleFormulaBarChange(value: string) {
    setEditing((prev) =>
      prev ? { ...prev, value } : { address: activeCell, value, source: "formula-bar" },
    );
  }

  function handleKeyDown(e: KeyboardEvent<HTMLElement>) {
    if (editing) {
      switch (e.key) {
        case "Enter":
          e.preventDefault();
          commitEdit("down");
          break;
        case "Tab":
          e.preventDefault();
          commitEdit("right");
          break;
        case "Escape":
          e.preventDefault();
          // Canceling an edit is specific enough that Escape shouldn't
          // also fall through to App.tsx's window-hide fallback.
          e.stopPropagation();
          cancelEdit();
          break;
      }
      return;
    }

    if ((e.metaKey || e.ctrlKey) && !e.altKey) {
      if (e.key === "c" || e.key === "C") {
        e.preventDefault();
        engine.copyRange(selection);
        setCopiedRange(selection);
        return;
      }
      if (e.key === "v" || e.key === "V") {
        e.preventDefault();
        engine.pasteAt({ row: selectionBounds.minRow, col: selectionBounds.minCol });
        pushHistory({ type: "content" });
        return;
      }
      if (e.key === "z" || e.key === "Z") {
        e.preventDefault();
        if (e.shiftKey) performRedo();
        else performUndo();
        return;
      }
      if (e.key === "y" || e.key === "Y") {
        e.preventDefault();
        performRedo();
        return;
      }
      if (e.key === "b" || e.key === "B") {
        e.preventDefault();
        applyToggle("bold");
        return;
      }
      if (e.key === "i" || e.key === "I") {
        e.preventDefault();
        applyToggle("italic");
        return;
      }
      if (e.key === "a" || e.key === "A") {
        // Without this, Cmd/Ctrl+A falls through to the browser's own
        // "select all text on the page" instead of selecting the grid's
        // cells — there was no handler for "a" here at all before.
        e.preventDefault();
        setSelection({
          anchor: { row: 0, col: 0 },
          focus: { row: rows - 1, col: cols - 1 },
        });
        return;
      }
    }

    switch (e.key) {
      case "ArrowUp":
        e.preventDefault();
        moveSelection(-1, 0);
        break;
      case "ArrowDown":
        e.preventDefault();
        moveSelection(1, 0);
        break;
      case "ArrowLeft":
        e.preventDefault();
        moveSelection(0, -1);
        break;
      case "ArrowRight":
        e.preventDefault();
        moveSelection(0, 1);
        break;
      case "Backspace":
        e.preventDefault();
        engine.clearRange(selection);
        pushHistory({ type: "content" });
        break;
      case "Escape":
        if (copiedRange) {
          // Only stop propagation when there was actually a copy
          // highlight to clear — with nothing more specific to do,
          // Escape should still fall through to App.tsx's window-hide
          // fallback.
          e.stopPropagation();
          engine.clearClipboard();
          setCopiedRange(null);
        }
        break;
      default:
        if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
          e.preventDefault();
          setSelection({ anchor: activeCell, focus: activeCell });
          setEditing({ address: activeCell, value: e.key, source: "cell" });
        }
    }
  }

  // Computed display values for every visible cell. Cheap enough to
  // recompute on every render given the grid is capped at 7 x 25.
  const displayValues: Record<string, string> = {};
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const address = { row, col };
      displayValues[addressKey(address)] = engine.getDisplayValue(address);
    }
  }

  const fillPreviewBounds: RangeBounds | null =
    dragMode === "fill" && fillPreviewEndRow !== null && fillPreviewEndRow > selectionBounds.maxRow
      ? {
          minRow: selectionBounds.maxRow + 1,
          maxRow: fillPreviewEndRow,
          minCol: selectionBounds.minCol,
          maxCol: selectionBounds.maxCol,
        }
      : null;
  const copiedBounds = copiedRange ? normalizeRange(copiedRange) : null;
  const formulaRefBounds = formulaRefDrag
    ? normalizeRange({ anchor: formulaRefDrag.anchor, focus: formulaRefDrag.focus })
    : null;

  const activeCellKey = addressKey(activeCell);
  const formulaBarValue = editing ? editing.value : engine.getRawInput(activeCell);
  const activeFormat: CellFormat = formatting.getFormat(activeCell);

  // CSV export writes computed *values* (what the grid shows, not formulas)
  // for the used area only. The download goes through the browser's normal
  // download path; Electron shows its native Save dialog for it.
  function handleExportCsv() {
    let maxRow = -1;
    let maxCol = -1;
    for (const key of Object.keys(engine.exportCells())) {
      const address = parseAddressKey(key);
      if (!address) continue;
      maxRow = Math.max(maxRow, address.row);
      maxCol = Math.max(maxCol, address.col);
    }
    const grid: string[][] = [];
    for (let r = 0; r <= maxRow; r++) {
      const line: string[] = [];
      for (let c = 0; c <= maxCol; c++) line.push(engine.getDisplayValue({ row: r, col: c }));
      grid.push(line);
    }
    const url = URL.createObjectURL(new Blob([toCsv(grid)], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "PAPI sheet.csv";
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  // Replaces the whole sheet. Cells are imported as typed text, so a value
  // starting with "=" becomes a live formula — same as typing it. Anything
  // outside the grid is dropped (and reported), and the file size is capped
  // so a huge file can't hang the UI.
  async function handleImportCsv(file: File) {
    if (file.size > MAX_IMPORT_BYTES) {
      window.alert("That file is too large to import (limit 2 MB).");
      return;
    }
    const hasData = Object.keys(engine.exportCells()).length > 0;
    if (hasData && !window.confirm("Importing replaces everything currently in the sheet. Continue?")) return;

    const parsed = parseCsv(await file.text());
    const cells: Record<string, string> = {};
    let dropped = false;
    parsed.forEach((line, r) => {
      line.forEach((value, c) => {
        if (value === "") return;
        if (r >= rows || c >= cols) {
          dropped = true;
          return;
        }
        cells[addressKey({ row: r, col: c })] = value;
      });
    });
    engine.importCells(cells);
    formatting.replaceAll({});
    setHistoryState({ entries: [], index: 0 });
    setSelection({ anchor: { row: 0, col: 0 }, focus: { row: 0, col: 0 } });
    if (dropped) window.alert(`Some cells were outside the ${rows}-row × ${cols}-column grid and were not imported.`);
  }

  return (
    <div className="spreadsheet-tab">
      <Toolbar
        activeFormat={activeFormat}
        onToggleBold={() => applyToggle("bold")}
        onToggleItalic={() => applyToggle("italic")}
        onSetFill={handleSetFill}
        onExportCsv={handleExportCsv}
        onImportCsv={(file) => void handleImportCsv(file)}
      />
      <FormulaBar
        addressLabel={activeCellKey}
        value={formulaBarValue}
        onChange={handleFormulaBarChange}
        onFocus={handleFormulaBarFocus}
        onKeyDown={handleKeyDown}
      />
      <div
        ref={containerRef}
        className="grid-area"
        tabIndex={0}
        onKeyDown={handleKeyDown}
      >
        <Grid
          rows={rows}
          cols={cols}
          activeCell={activeCell}
          selectionBounds={selectionBounds}
          fillPreviewBounds={fillPreviewBounds}
          copiedBounds={copiedBounds}
          formulaRefBounds={formulaRefBounds}
          isDragging={dragMode !== null}
          displayValues={displayValues}
          getFormat={formatting.getFormat}
          editing={editing}
          editingInputRef={editingInputRef}
          onCellMouseDown={handleCellMouseDown}
          onCellMouseEnter={handleCellMouseEnter}
          onFillHandleMouseDown={handleFillHandleMouseDown}
          onDoubleClick={handleDoubleClick}
          onEditValueChange={handleEditValueChange}
        />
      </div>
    </div>
  );
}
