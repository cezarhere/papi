import type { MouseEvent } from "react";
import { NUMBER_FORMAT_OPTIONS, type NumberFormat } from "./numberFormat";
import type { CellFormat } from "./types";
import "./Toolbar.css";

// Defaults from SPEC.md's "Formatting" section — change freely.
const FILL_COLORS = [
  { label: "Yellow", value: "#FFF2AC" },
  { label: "Green", value: "#C6E9C6" },
  { label: "Blue", value: "#CFE3FA" },
];

interface ToolbarProps {
  activeFormat: CellFormat;
  onToggleBold: () => void;
  onToggleItalic: () => void;
  onSetFill: (color: string) => void;
  onSetNumberFormat: (format: NumberFormat | "general") => void;
  onChangeDecimals: (delta: 1 | -1) => void;
}

// Toolbar buttons act on the grid's selection, so they must not take
// keyboard focus away from it (the arrow keys would stop working until the
// next click on a cell).
const keepFocus = (e: MouseEvent) => e.preventDefault();

export default function Toolbar({
  activeFormat,
  onToggleBold,
  onToggleItalic,
  onSetFill,
  onSetNumberFormat,
  onChangeDecimals,
}: ToolbarProps) {
  return (
    <div className="toolbar">
      <div className="toolbar-group">
        <button
          type="button"
          className={activeFormat.bold ? "toolbar-button is-on" : "toolbar-button"}
          onMouseDown={keepFocus}
          onClick={onToggleBold}
          aria-pressed={activeFormat.bold === true}
          aria-label="Bold"
          title="Bold (⌘B)"
        >
          <span className="toolbar-icon-bold">B</span>
        </button>
        <button
          type="button"
          className={activeFormat.italic ? "toolbar-button is-on" : "toolbar-button"}
          onMouseDown={keepFocus}
          onClick={onToggleItalic}
          aria-pressed={activeFormat.italic === true}
          aria-label="Italic"
          title="Italic (⌘I)"
        >
          <span className="toolbar-icon-italic">I</span>
        </button>
      </div>
      <div className="toolbar-divider" />
      <div className="toolbar-group">
        {FILL_COLORS.map(({ label, value }) => (
          <button
            key={value}
            type="button"
            className={activeFormat.fill === value ? "toolbar-swatch is-on" : "toolbar-swatch"}
            style={{ backgroundColor: value }}
            onMouseDown={keepFocus}
            onClick={() => onSetFill(value)}
            aria-pressed={activeFormat.fill === value}
            aria-label={`${label} fill`}
            title={`${label} fill`}
          />
        ))}
      </div>
      <div className="toolbar-divider" />
      <select
        className="toolbar-select"
        value={activeFormat.numberFormat ?? "general"}
        onChange={(e) => onSetNumberFormat(e.target.value as NumberFormat | "general")}
        title="Number format"
        aria-label="Number format"
      >
        {NUMBER_FORMAT_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <div className="toolbar-group toolbar-group-joined">
        <button
          type="button"
          className="toolbar-button toolbar-button-text"
          onMouseDown={keepFocus}
          onClick={() => onChangeDecimals(-1)}
          title="Fewer decimal places"
          aria-label="Fewer decimal places"
        >
          .0
        </button>
        <button
          type="button"
          className="toolbar-button toolbar-button-text"
          onMouseDown={keepFocus}
          onClick={() => onChangeDecimals(1)}
          title="More decimal places"
          aria-label="More decimal places"
        >
          .00
        </button>
      </div>
    </div>
  );
}
