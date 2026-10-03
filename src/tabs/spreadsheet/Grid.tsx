import { Fragment, type MouseEvent, type RefObject } from "react";
import { addressKey } from "./address";
import Cell from "./Cell";
import { CELL_HEIGHT, COL_HEADER_HEIGHT, ROW_HEADER_WIDTH } from "./constants";
import { clampWidth } from "./useColumnWidths";
import { refEdgesForCell } from "./formulaRefs";
import { isCellInBounds, type RangeBounds } from "./range";
import type { CellAddress, CellFormat, EditingState } from "./types";
import { columnLabel } from "./utils";
import "./Grid.css";

interface GridProps {
  rows: number;
  cols: number;
  activeCell: CellAddress;
  selectionBounds: RangeBounds;
  fillPreviewBounds: RangeBounds | null;
  copiedBounds: RangeBounds | null;
  // Every range referenced by the formula being edited, outlined for as
  // long as it stays open.
  formulaRefs: RangeBounds[];
  isDragging: boolean;
  displayValues: Record<string, string>;
  // Keys of cells whose computed value is a number (right-aligned).
  numericKeys: ReadonlySet<string>;
  getColumnWidth: (col: number) => number;
  onColumnResize: (col: number, width: number) => void;
  onColumnAutoFit: (col: number) => void;
  getFormat: (address: CellAddress) => CellFormat;
  editing: EditingState | null;
  editingInputRef: RefObject<HTMLInputElement>;
  onCellMouseDown: (address: CellAddress, e: MouseEvent) => void;
  onCellMouseEnter: (address: CellAddress) => void;
  onFillHandleMouseDown: (e: MouseEvent) => void;
  onDoubleClick: (address: CellAddress) => void;
  onEditValueChange: (value: string) => void;
}

export default function Grid({
  rows,
  cols,
  activeCell,
  selectionBounds,
  fillPreviewBounds,
  copiedBounds,
  formulaRefs,
  isDragging,
  displayValues,
  numericKeys,
  getColumnWidth,
  onColumnResize,
  onColumnAutoFit,
  getFormat,
  editing,
  editingInputRef,
  onCellMouseDown,
  onCellMouseEnter,
  onFillHandleMouseDown,
  onDoubleClick,
  onEditValueChange,
}: GridProps) {
  const columns = Array.from({ length: cols }, (_, i) => i);
  const rowIndexes = Array.from({ length: rows }, (_, i) => i);

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

  return (
    <div
      className="grid"
      style={{
        gridTemplateColumns: `${ROW_HEADER_WIDTH}px ${columns.map((col) => `${getColumnWidth(col)}px`).join(" ")}`,
        gridTemplateRows: `${COL_HEADER_HEIGHT}px repeat(${rows}, ${CELL_HEIGHT}px)`,
      }}
    >
      <div className="grid-header grid-corner" />
      {columns.map((col) => (
        <div key={`col-${col}`} className="grid-header grid-header-col">
          {columnLabel(col)}
          {/* Left edge doubles as the *previous* column's handle, so the grab
              zone straddles the border line like Excel's (right-edge only
              meant clicking on the line itself, or just past it, missed). */}
          {col > 0 && (
            <div
              className="grid-col-resize-handle grid-col-resize-handle-left"
              onMouseDown={(e) => startColumnResize(col - 1, e)}
              onDoubleClick={(e) => {
                e.stopPropagation();
                onColumnAutoFit(col - 1);
              }}
              title="Drag to resize, double-click to fit"
            />
          )}
          <div
            className="grid-col-resize-handle"
            onMouseDown={(e) => startColumnResize(col, e)}
            onDoubleClick={(e) => {
              e.stopPropagation();
              onColumnAutoFit(col);
            }}
            title="Drag to resize, double-click to fit"
          />
        </div>
      ))}

      {rowIndexes.map((row) => (
        <Fragment key={`row-${row}`}>
          <div className="grid-header grid-header-row">{row + 1}</div>
          {columns.map((col) => {
            const address: CellAddress = { row, col };
            const isEditing =
              editing !== null &&
              editing.address.row === row &&
              editing.address.col === col;
            const inSelection = isCellInBounds(address, selectionBounds);
            const isActive = activeCell.row === row && activeCell.col === col;
            const isFillPreview = fillPreviewBounds !== null && isCellInBounds(address, fillPreviewBounds);
            const isCopied = copiedBounds !== null && isCellInBounds(address, copiedBounds);
            const refEdges = refEdgesForCell(row, col, formulaRefs);
            const showFillHandle =
              !isDragging &&
              row === selectionBounds.maxRow &&
              col === selectionBounds.maxCol;

            return (
              <Cell
                key={`cell-${row}-${col}`}
                addressKey={addressKey(address)}
                content={displayValues[addressKey(address)] ?? ""}
                format={getFormat(address)}
                inSelection={inSelection}
                isActive={isActive}
                isFillPreview={isFillPreview}
                isCopied={isCopied}
                refEdges={refEdges}
                isNumeric={numericKeys.has(addressKey(address))}
                showFillHandle={showFillHandle}
                editing={isEditing}
                editValue={editing !== null && isEditing ? editing.value : ""}
                takesFocus={editing !== null && isEditing && editing.source === "cell"}
                inputRef={editingInputRef}
                onMouseDown={(e) => onCellMouseDown(address, e)}
                onMouseEnter={() => onCellMouseEnter(address)}
                onFillHandleMouseDown={onFillHandleMouseDown}
                onDoubleClick={() => onDoubleClick(address)}
                onEditValueChange={onEditValueChange}
              />
            );
          })}
        </Fragment>
      ))}
    </div>
  );
}
