import { useRef, type ChangeEvent } from "react";
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
  onExportCsv: () => void;
  onImportCsv: (file: File) => void;
}

export default function Toolbar({
  activeFormat,
  onToggleBold,
  onToggleItalic,
  onSetFill,
  onExportCsv,
  onImportCsv,
}: ToolbarProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  function handleFileChosen(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    // Reset so choosing the same file twice in a row still fires onChange.
    e.target.value = "";
    if (file) onImportCsv(file);
  }

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
      <div className="toolbar-spacer" />
      <button type="button" className="toolbar-text-button" onClick={() => fileInputRef.current?.click()} title="Replace the sheet with a CSV file">
        Import CSV
      </button>
      <button type="button" className="toolbar-text-button" onClick={onExportCsv} title="Save the sheet's values as a CSV file">
        Export CSV
      </button>
      <input ref={fileInputRef} type="file" accept=".csv,text/csv" hidden onChange={handleFileChosen} />
    </div>
  );
}
