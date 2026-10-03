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
      <button
        type="button"
        className={
          activeFormat.bold ? "toolbar-button toolbar-button-active" : "toolbar-button"
        }
        onClick={onToggleBold}
        aria-pressed={activeFormat.bold === true}
        title="Bold"
      >
        <span className="toolbar-icon-bold">B</span>
      </button>
      <button
        type="button"
        className={
          activeFormat.italic ? "toolbar-button toolbar-button-active" : "toolbar-button"
        }
        onClick={onToggleItalic}
        aria-pressed={activeFormat.italic === true}
        title="Italic"
      >
        <span className="toolbar-icon-italic">I</span>
      </button>
      <div className="toolbar-divider" />
      {FILL_COLORS.map(({ label, value }) => (
        <button
          key={value}
          type="button"
          className={
            activeFormat.fill === value ? "toolbar-swatch toolbar-swatch-active" : "toolbar-swatch"
          }
          style={{ backgroundColor: value }}
          onClick={() => onSetFill(value)}
          aria-pressed={activeFormat.fill === value}
          title={`${label} fill`}
        />
      ))}
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
      <button
        type="button"
        className="toolbar-button"
        onClick={() => onChangeDecimals(-1)}
        title="Fewer decimal places"
        aria-label="Fewer decimal places"
      >
        .0&#8592;
      </button>
      <button
        type="button"
        className="toolbar-button"
        onClick={() => onChangeDecimals(1)}
        title="More decimal places"
        aria-label="More decimal places"
      >
        .00&#8594;
      </button>
    </div>
  );
}
