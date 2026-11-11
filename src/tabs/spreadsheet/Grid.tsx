import { useEffect, useLayoutEffect, useState, type MouseEvent, type RefObject } from "react";
import { CELL_HEIGHT, COL_HEADER_HEIGHT, ROW_HEADER_WIDTH } from "./constants";
import { rectFor, type Geometry } from "./geometry";
import GridCells from "./GridCells";
import type { RangeBounds } from "./range";
import SelectionOverlay from "./SelectionOverlay";
import type { DisplayCell } from "./sheetView";
import type { CellAddress, CellFormat, EditingState } from "./types";
import { clampWidth } from "./useColumnWidths";
import { columnLabel } from "./utils";
import "./Grid.css";

interface GridProps {
  rows: number;
  cols: number;
  gridRef: RefObject<HTMLDivElement>;
  geometry: Geometry;
  cells: Record<string, DisplayCell>;
  formats: Record<string, CellFormat>;
  activeCell: CellAddress;
  selectionBounds: RangeBounds;
  fillPreviewBounds: RangeBounds | null;
  copied: { bounds: RangeBounds; cut: boolean } | null;
  // Every range referenced by the formula being edited, outlined (one
  // colour each) for as long as it stays open.
  formulaRefs: RangeBounds[];
  isDragging: boolean;
  getColumnWidth: (col: number) => number;
  onColumnResize: (col: number, width: number) => void;
  onColumnAutoFit: (col: number) => void;
  editing: EditingState | null;
  editingInputRef: RefObject<HTMLInputElement>;
  onFillHandleMouseDown: (e: MouseEvent) => void;
  onEditValueChange: (value: string, caret: number) => void;
  onEditCaretChange: (caret: number) => void;
  onEditorMouseDown: () => void;
}

export default function Grid({
  rows,
  cols,
  gridRef,
  geometry,
  cells,
  formats,
  activeCell,
  selectionBounds,
  fillPreviewBounds,
  copied,
  formulaRefs,
  isDragging,
  getColumnWidth,
  onColumnResize,
  onColumnAutoFit,
  editing,
  editingInputRef,
  onFillHandleMouseDown,
  onEditValueChange,
  onEditCaretChange,
  onEditorMouseDown,
}: GridProps) {
  const columns = Array.from({ length: cols }, (_, i) => i);
  const rowIndexes = Array.from({ length: rows }, (_, i) => i);

  // The grid's own computed font, for measuring text (spill, ####).
  const [font, setFont] = useState<{ size: string; family: string } | null>(null);
  useLayoutEffect(() => {
    if (!gridRef.current) return;
    const style = getComputedStyle(gridRef.current);
    setFont({ size: style.fontSize, family: style.fontFamily });
  }, [gridRef]);

  // Drag the right edge of a column header to resize it. Window-level
  // listeners so the drag keeps tracking when the cursor leaves the thin
  // handle; document.body's cursor is pinned for the duration.
  function startColumnResize(col: number, e: MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startWidth = getColumnWidth(col);
    document.body.style.cursor = "col-resize";
    function onMove(ev: globalThis.MouseEvent) {
      onColumnResize(col, clampWidth(startWidth + ev.clientX - startX));
    }
    function onUp() {
      document.body.style.cursor = "";
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  const resizeHandle = (col: number, left: boolean) => (
    <div
      className={left ? "grid-col-resize-handle grid-col-resize-handle-left" : "grid-col-resize-handle"}
      onMouseDown={(e) => startColumnResize(col, e)}
      onDoubleClick={(e) => {
        e.stopPropagation();
        onColumnAutoFit(col);
      }}
    />
  );

  const editorRect = editing
    ? rectFor(
        {
          minRow: editing.address.row,
          maxRow: editing.address.row,
          minCol: editing.address.col,
          maxCol: editing.address.col,
        },
        geometry,
      )
    : null;

  return (
    <div
      ref={gridRef}
      className="grid"
      style={{
        gridTemplateColumns: `${ROW_HEADER_WIDTH}px ${columns.map((col) => `${getColumnWidth(col)}px`).join(" ")}`,
        gridTemplateRows: `${COL_HEADER_HEIGHT}px repeat(${rows}, ${CELL_HEIGHT}px)`,
        width: geometry.width,
      }}
    >
      {/* Grid lines: one element per column and per row, spanning the whole
          sheet — empty cells have no DOM of their own. */}
      {columns.map((col) => (
        <div key={`vline-${col}`} className="grid-line grid-line-col" style={{ gridColumn: col + 2, gridRow: "2 / -1" }} />
      ))}
      {rowIndexes.map((row) => (
        <div key={`hline-${row}`} className="grid-line grid-line-row" style={{ gridRow: row + 2, gridColumn: "2 / -1" }} />
      ))}

      <GridCells cells={cells} formats={formats} geometry={geometry} cols={cols} font={font} />

      <SelectionOverlay
        geometry={geometry}
        selection={selectionBounds}
        activeCell={activeCell}
        editing={editing !== null}
        dragging={isDragging}
        fillPreview={fillPreviewBounds}
        copied={copied}
        formulaRefs={formulaRefs}
        onFillHandleMouseDown={onFillHandleMouseDown}
      />

      {editing && editorRect && (
        <CellEditor
          inputRef={editingInputRef}
          value={editing.value}
          takesFocus={editing.source === "cell"}
          left={editorRect.left}
          top={editorRect.top}
          minWidth={editorRect.width}
          maxWidth={geometry.width - editorRect.left}
          onChange={onEditValueChange}
          onCaretChange={onEditCaretChange}
          onMouseDown={onEditorMouseDown}
        />
      )}

      <div className="grid-header grid-corner" style={{ gridRow: 1, gridColumn: 1 }} />
      {columns.map((col) => {
        const selected = col >= selectionBounds.minCol && col <= selectionBounds.maxCol;
        return (
          <div
            key={`col-${col}`}
            className={selected ? "grid-header grid-header-col is-selected" : "grid-header grid-header-col"}
            style={{ gridRow: 1, gridColumn: col + 2 }}
          >
            {columnLabel(col)}
            {/* Left edge doubles as the *previous* column's handle, so the grab
                zone straddles the border line like Excel's. */}
            {col > 0 && resizeHandle(col - 1, true)}
            {resizeHandle(col, false)}
          </div>
        );
      })}
      {rowIndexes.map((row) => {
        const selected = row >= selectionBounds.minRow && row <= selectionBounds.maxRow;
        return (
          <div
            key={`row-${row}`}
            className={selected ? "grid-header grid-header-row is-selected" : "grid-header grid-header-row"}
            style={{ gridRow: row + 2, gridColumn: 1 }}
          >
            {row + 1}
          </div>
        );
      })}
    </div>
  );
}

interface CellEditorProps {
  inputRef: RefObject<HTMLInputElement>;
  value: string;
  // Only true when this edit was started from the cell itself (typing,
  // double-click, F2). An edit started in the formula bar still shows its
  // text here, live, but must not pull focus away from the bar.
  takesFocus: boolean;
  left: number;
  top: number;
  minWidth: number;
  maxWidth: number;
  onChange: (value: string, caret: number) => void;
  onCaretChange: (caret: number) => void;
  onMouseDown: () => void;
}

// The in-cell editor: one input floated over the cell being edited. It
// starts at the cell's size and grows with its text (field-sizing), like
// Excel's, instead of scrolling inside a narrow column.
function CellEditor({
  inputRef,
  value,
  takesFocus,
  left,
  top,
  minWidth,
  maxWidth,
  onChange,
  onCaretChange,
  onMouseDown,
}: CellEditorProps) {
  useEffect(() => {
    if (!takesFocus) return;
    const input = inputRef.current;
    if (!input) return;
    input.focus();
    const end = input.value.length;
    input.setSelectionRange(end, end);
    // Mount-only: focus once when the edit starts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <input
      ref={inputRef}
      className="cell-editor"
      style={{ left, top, minWidth: minWidth + 1, maxWidth, height: CELL_HEIGHT + 1 }}
      value={value}
      spellCheck={false}
      autoComplete="off"
      onChange={(e) => onChange(e.target.value, e.target.selectionStart ?? e.target.value.length)}
      onSelect={(e) => onCaretChange(e.currentTarget.selectionStart ?? 0)}
      onMouseDown={onMouseDown}
    />
  );
}
