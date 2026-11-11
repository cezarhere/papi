import type { KeyboardEvent, RefObject } from "react";
import "./FormulaBar.css";

interface FormulaBarProps {
  inputRef: RefObject<HTMLInputElement>;
  // The active cell ("B4"), or the size of a selection being dragged ("3R × 2C").
  addressLabel: string;
  value: string;
  isEditing: boolean;
  onChange: (value: string, caret: number) => void;
  onCaretChange: (caret: number) => void;
  onFocus: () => void;
  onMouseDown: () => void;
  onKeyDown: (e: KeyboardEvent<HTMLInputElement>) => void;
}

export default function FormulaBar({
  inputRef,
  addressLabel,
  value,
  isEditing,
  onChange,
  onCaretChange,
  onFocus,
  onMouseDown,
  onKeyDown,
}: FormulaBarProps) {
  return (
    <div className="formula-bar">
      <div className="formula-bar-address">{addressLabel}</div>
      <div className="formula-bar-fx" aria-hidden="true">
        fx
      </div>
      <input
        ref={inputRef}
        className="formula-bar-value"
        aria-label="Cell contents"
        value={value}
        spellCheck={false}
        autoComplete="off"
        onChange={(e) => onChange(e.target.value, e.target.selectionStart ?? e.target.value.length)}
        onSelect={(e) => {
          if (isEditing) onCaretChange(e.currentTarget.selectionStart ?? 0);
        }}
        onFocus={onFocus}
        onMouseDown={onMouseDown}
        onKeyDown={onKeyDown}
      />
    </div>
  );
}
