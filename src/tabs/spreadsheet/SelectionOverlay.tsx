import { useEffect, useRef, type MouseEvent } from "react";
import { rectFor, type Geometry, type Rect } from "./geometry";
import type { RangeBounds } from "./range";
import type { CellAddress } from "./types";

// Colours cycle per reference in the formula being edited, like Excel.
export const REF_COLOR_COUNT = 6;

interface SelectionOverlayProps {
  geometry: Geometry;
  selection: RangeBounds;
  activeCell: CellAddress;
  // Hidden while a cell is being edited (the editor draws its own frame).
  editing: boolean;
  dragging: boolean;
  fillPreview: RangeBounds | null;
  copied: { bounds: RangeBounds; cut: boolean } | null;
  formulaRefs: RangeBounds[];
  onFillHandleMouseDown: (e: MouseEvent) => void;
}

const box = (rect: Rect) => ({ left: rect.left, top: rect.top, width: rect.width, height: rect.height });
// A frame around a block of cells: one pixel out on the top and left, so its
// border sits on the grid lines that surround the block on all four sides.
const frame = (rect: Rect) => ({ left: rect.left - 1, top: rect.top - 1, width: rect.width + 1, height: rect.height + 1 });

// Everything drawn on top of the cells: the selection, the fill handle, the
// "copied" marching ants, the fill preview and the outlines of the ranges a
// formula refers to. Positioned from Geometry, so moving the selection
// touches these few elements and nothing else.
export default function SelectionOverlay({
  geometry,
  selection,
  activeCell,
  editing,
  dragging,
  fillPreview,
  copied,
  formulaRefs,
  onFillHandleMouseDown,
}: SelectionOverlayProps) {
  const selectionRect = rectFor(selection, geometry);
  const activeRect = rectFor(
    { minRow: activeCell.row, maxRow: activeCell.row, minCol: activeCell.col, maxCol: activeCell.col },
    geometry,
  );
  const isRange = selection.minRow !== selection.maxRow || selection.minCol !== selection.maxCol;

  // Only a single cell moving to another single cell glides; collapsing a
  // range (or a whole column) down to one cell would be a distracting swoop.
  const wasRange = useRef(isRange);
  const animate = !isRange && !wasRange.current && !dragging;
  useEffect(() => {
    wasRange.current = isRange;
  }, [isRange]);

  // The tint covers the range except the active cell, which stays clear (as
  // in Excel) — cut out with an even-odd polygon: outer rectangle, then the
  // hole.
  const holeLeft = activeRect.left - selectionRect.left;
  const holeTop = activeRect.top - selectionRect.top;
  const holeRight = holeLeft + activeRect.width;
  const holeBottom = holeTop + activeRect.height;
  const tintClip = `polygon(evenodd, 0 0, 100% 0, 100% 100%, 0 100%, 0 0, ${holeLeft}px ${holeTop}px, ${holeLeft}px ${holeBottom}px, ${holeRight}px ${holeBottom}px, ${holeRight}px ${holeTop}px, ${holeLeft}px ${holeTop}px)`;

  return (
    <>
      {formulaRefs.map((ref, index) => (
        <div
          key={`ref-${index}`}
          className={`overlay overlay-ref overlay-ref-${index % REF_COLOR_COUNT}`}
          style={frame(rectFor(ref, geometry))}
        />
      ))}
      {copied && (
        <svg className={copied.cut ? "overlay overlay-copied overlay-cut" : "overlay overlay-copied"} style={frame(rectFor(copied.bounds, geometry))}>
          <rect x="1" y="1" width="calc(100% - 2px)" height="calc(100% - 2px)" />
        </svg>
      )}
      {!editing && (
        <>
          {isRange && <div className="overlay overlay-tint" style={{ ...box(selectionRect), clipPath: tintClip }} />}
          <div
            className={animate ? "overlay overlay-selection overlay-animated" : "overlay overlay-selection"}
            style={frame(selectionRect)}
          >
            {!dragging && <div className="fill-handle" onMouseDown={onFillHandleMouseDown} />}
          </div>
        </>
      )}
      {fillPreview && <div className="overlay overlay-fill-preview" style={frame(rectFor(fillPreview, geometry))} />}
    </>
  );
}
