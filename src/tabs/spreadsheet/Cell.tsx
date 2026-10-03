import { useEffect, type CSSProperties, type MouseEvent, type RefObject } from "react";
import type { CellFormat } from "./types";

interface CellProps {
  // "A1"-style key, used only as a data attribute so the scroll-into-view
  // effect in SpreadsheetTab.tsx can find this cell's DOM node by address.
  addressKey: string;
  content: string;
  format: CellFormat;
  inSelection: boolean;
  isActive: boolean;
  isFillPreview: boolean;
  isCopied: boolean;
  isFormulaRef: boolean;
  showFillHandle: boolean;
  editing: boolean;
  editValue: string;
  // Only true when this edit was started from the cell itself (double-
  // click or typing directly on it) — see EditingState's `source`.
  // Prevents this cell from stealing focus away from the formula bar
  // when an edit was started there instead.
  takesFocus: boolean;
  inputRef: RefObject<HTMLInputElement>;
  onMouseDown: (e: MouseEvent) => void;
  onMouseEnter: () => void;
  onFillHandleMouseDown: (e: MouseEvent) => void;
  onDoubleClick: () => void;
  onEditValueChange: (value: string) => void;
}

export default function Cell({
  addressKey,
  content,
  format,
  inSelection,
  isActive,
  isFillPreview,
  isCopied,
  isFormulaRef,
  showFillHandle,
  editing,
  editValue,
  takesFocus,
  inputRef,
  onMouseDown,
  onMouseEnter,
  onFillHandleMouseDown,
  onDoubleClick,
  onEditValueChange,
}: CellProps) {
  // Focus the input and place the caret at the end whenever this cell
  // becomes the one being edited.
  useEffect(() => {
    if (!editing || !takesFocus) return;
    const input = inputRef.current;
    if (!input) return;
    input.focus();
    const len = input.value.length;
    input.setSelectionRange(len, len);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing, takesFocus]);

  const classNames = ["grid-cell"];
  if (inSelection) classNames.push("grid-cell-in-selection");
  if (isActive) classNames.push("grid-cell-active");
  if (isFillPreview) classNames.push("grid-cell-fill-preview");
  if (isCopied) classNames.push("grid-cell-copied");
  if (isFormulaRef) classNames.push("grid-cell-formula-ref");

  const style: CSSProperties = {};
  if (format.fill) {
    style.backgroundColor = format.fill;
    // Fill presets are light pastels (SPEC.md); the theme's default text
    // color is near-white, which is unreadable against them. Force a dark
    // color specifically here rather than adding a token for a case that's
    // about contrast against user-chosen content, not app chrome.
    style.color = "#1a1a1a";
  }
  if (format.bold) style.fontWeight = 700;
  if (format.italic) style.fontStyle = "italic";

  return (
    <div
      className={classNames.join(" ")}
      style={style}
      data-address={addressKey}
      onMouseDown={onMouseDown}
      onMouseEnter={onMouseEnter}
      onDoubleClick={onDoubleClick}
    >
      {editing ? (
        <input
          ref={inputRef}
          className="grid-cell-input"
          value={editValue}
          onChange={(e) => onEditValueChange(e.target.value)}
        />
      ) : (
        content
      )}
      {showFillHandle && (
        <div className="fill-handle" onMouseDown={onFillHandleMouseDown} />
      )}
    </div>
  );
}
