import type { KeyboardEvent } from "react";
import "./FormulaBar.css";

interface FormulaBarProps {
  addressLabel: string;
  value: string;
  onChange: (value: string) => void;
  onFocus: () => void;
  onKeyDown: (e: KeyboardEvent<HTMLInputElement>) => void;
}

export default function FormulaBar({ addressLabel, value, onChange, onFocus, onKeyDown }: FormulaBarProps) {
  return (
    <div className="formula-bar">
      <div className="formula-bar-address">{addressLabel}</div>
      <input
        className="formula-bar-value"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={onFocus}
        onKeyDown={onKeyDown}
      />
    </div>
  );
}
