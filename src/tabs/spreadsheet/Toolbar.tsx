import type { MouseEvent, ReactNode } from "react";
import { NUMBER_FORMAT_OPTIONS, type NumberFormat } from "./numberFormat";
import type { CellFormat } from "./types";
import "./Toolbar.css";

// Defaults from SPEC.md's "Formatting" section — change freely.
const FILL_COLORS = [
  { label: "Yellow", value: "#FFF2AC" },
  { label: "Green", value: "#C6E9C6" },
  { label: "Blue", value: "#CFE3FA" },
];

export type AutoFunction = "SUM" | "AVERAGE" | "COUNT" | "MIN" | "MAX";
export type StructureCommand = "row-above" | "row-below" | "col-left" | "col-right" | "delete-rows" | "delete-cols";
type Align = "auto" | "left" | "center" | "right";

interface ToolbarProps {
  activeFormat: CellFormat;
  onToggleBold: () => void;
  onToggleItalic: () => void;
  onSetFill: (color: string) => void;
  onSetNumberFormat: (format: NumberFormat | "general") => void;
  onToggleNumberFormat: (format: NumberFormat) => void;
  onChangeDecimals: (delta: 1 | -1) => void;
  onSetAlign: (align: Align) => void;
  onAutoFunction: (name: AutoFunction) => void;
  onSort: (descending: boolean) => void;
  onStructure: (command: StructureCommand) => void;
}

// Toolbar buttons act on the grid's selection, so they must not take
// keyboard focus away from it (the arrow keys would stop working until the
// next click on a cell).
const keepFocus = (e: MouseEvent) => e.preventDefault();

const icon = (children: ReactNode) => (
  <svg
    viewBox="0 0 16 16"
    width="16"
    height="16"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.4"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    {children}
  </svg>
);

const ALIGN_ICONS: Record<Align, ReactNode> = {
  auto: icon(<path d="M2.5 4h11M2.5 8h7M2.5 12h11" />),
  left: icon(<path d="M2.5 4h11M2.5 8h7M2.5 12h9" />),
  center: icon(<path d="M2.5 4h11M4.5 8h7M3.5 12h9" />),
  right: icon(<path d="M2.5 4h11M6.5 8h7M4.5 12h9" />),
};
const SORT_ASCENDING = icon(<path d="M4.5 3v10M2.5 11l2 2 2-2M9 4.5h2.5M9 8h4M9 11.5h5.5" />);
const SORT_DESCENDING = icon(<path d="M4.5 3v10M2.5 11l2 2 2-2M9 4.5h5.5M9 8h4M9 11.5h2.5" />);
const ROWS_ICON = icon(
  <>
    <rect x="2.5" y="3" width="11" height="10" rx="1.5" />
    <path d="M2.5 6.5h11M2.5 9.5h11M6.5 3v10" />
  </>,
);

interface MenuOption {
  value: string;
  label: string;
  // Draws a separator line above this option.
  separated?: boolean;
}

interface MenuButtonProps {
  label: string;
  children: ReactNode;
  options: MenuOption[];
  // The option to show as ticked (a setting); omit for a menu of actions.
  value?: string;
  onSelect: (value: string) => void;
}

// A pull-down: what you see is an icon and a chevron, what you click is an
// invisible <select> laid over them — so the menu that opens is the
// system's own (a real NSMenu in the app), with its tick mark, keyboard
// navigation and type-to-select, rather than an imitation of one.
function MenuButton({ label, children, options, value, onSelect }: MenuButtonProps) {
  return (
    <label className="toolbar-menu" title={label}>
      {children}
      <svg className="toolbar-menu-chevron" viewBox="0 0 8 5" width="8" height="5" aria-hidden="true">
        <path d="M1 1l3 3 3-3" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <select
        aria-label={label}
        value={value ?? ""}
        onChange={(e) => {
          if (e.target.value !== "") onSelect(e.target.value);
        }}
      >
        {value === undefined && (
          <option value="" disabled hidden>
            {label}
          </option>
        )}
        {options.map((option) => [
          option.separated && <hr key={`${option.value}-separator`} />,
          <option key={option.value} value={option.value}>
            {option.label}
          </option>,
        ])}
      </select>
    </label>
  );
}

const ALIGN_OPTIONS: MenuOption[] = [
  { value: "auto", label: "Automatic" },
  { value: "left", label: "Left", separated: true },
  { value: "center", label: "Centre" },
  { value: "right", label: "Right" },
];

const FUNCTION_OPTIONS: MenuOption[] = [
  { value: "SUM", label: "Sum" },
  { value: "AVERAGE", label: "Average" },
  { value: "COUNT", label: "Count" },
  { value: "MIN", label: "Min" },
  { value: "MAX", label: "Max" },
];

const STRUCTURE_OPTIONS: MenuOption[] = [
  { value: "row-above", label: "Insert Row Above" },
  { value: "row-below", label: "Insert Row Below" },
  { value: "col-left", label: "Insert Column Left", separated: true },
  { value: "col-right", label: "Insert Column Right" },
  { value: "delete-rows", label: "Delete Rows", separated: true },
  { value: "delete-cols", label: "Delete Columns" },
];

export default function Toolbar({
  activeFormat,
  onToggleBold,
  onToggleItalic,
  onSetFill,
  onSetNumberFormat,
  onToggleNumberFormat,
  onChangeDecimals,
  onSetAlign,
  onAutoFunction,
  onSort,
  onStructure,
}: ToolbarProps) {
  const toggle = (on: boolean, extra = "") => `toolbar-button${extra}${on ? " is-on" : ""}`;
  const align: Align = activeFormat.align ?? "auto";

  return (
    <div className="toolbar">
      <div className="toolbar-group">
        <button
          type="button"
          className={toggle(activeFormat.bold === true)}
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
          className={toggle(activeFormat.italic === true)}
          onMouseDown={keepFocus}
          onClick={onToggleItalic}
          aria-pressed={activeFormat.italic === true}
          aria-label="Italic"
          title="Italic (⌘I)"
        >
          <span className="toolbar-icon-italic">I</span>
        </button>
        <MenuButton label="Alignment" options={ALIGN_OPTIONS} value={align} onSelect={(value) => onSetAlign(value as Align)}>
          {ALIGN_ICONS[align]}
        </MenuButton>
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
      <div className="toolbar-group">
        <button
          type="button"
          className={toggle(activeFormat.numberFormat === "usd", " toolbar-button-text")}
          onMouseDown={keepFocus}
          onClick={() => onToggleNumberFormat("usd")}
          aria-pressed={activeFormat.numberFormat === "usd"}
          aria-label="Currency"
          title="Currency ($)"
        >
          $
        </button>
        <button
          type="button"
          className={toggle(activeFormat.numberFormat === "percent", " toolbar-button-text")}
          onMouseDown={keepFocus}
          onClick={() => onToggleNumberFormat("percent")}
          aria-pressed={activeFormat.numberFormat === "percent"}
          aria-label="Percent"
          title="Percent"
        >
          %
        </button>
        <button
          type="button"
          className={toggle(activeFormat.numberFormat === "number", " toolbar-button-text")}
          onMouseDown={keepFocus}
          onClick={() => onToggleNumberFormat("number")}
          aria-pressed={activeFormat.numberFormat === "number"}
          aria-label="Thousands separator"
          title="Thousands separator (1,234)"
        >
          ,
        </button>
        <MenuButton
          label="Number format"
          options={NUMBER_FORMAT_OPTIONS}
          value={activeFormat.numberFormat ?? "general"}
          onSelect={(value) => onSetNumberFormat(value as NumberFormat | "general")}
        >
          <span className="toolbar-menu-text">123</span>
        </MenuButton>
      </div>
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

      <div className="toolbar-divider" />
      <div className="toolbar-group">
        {/* Σ on its own is Sum (by far the usual one); the chevron beside it
            has the rest. */}
        <div className="toolbar-split">
          <button
            type="button"
            className="toolbar-button toolbar-button-sigma"
            onMouseDown={keepFocus}
            onClick={() => onAutoFunction("SUM")}
            aria-label="Sum"
            title="Sum the selection, or the numbers above"
          >
            Σ
          </button>
          <MenuButton label="More functions" options={FUNCTION_OPTIONS} onSelect={(value) => onAutoFunction(value as AutoFunction)}>
            {null}
          </MenuButton>
        </div>
        <button
          type="button"
          className="toolbar-button"
          onMouseDown={keepFocus}
          onClick={() => onSort(false)}
          aria-label="Sort ascending"
          title="Sort A → Z, smallest first"
        >
          {SORT_ASCENDING}
        </button>
        <button
          type="button"
          className="toolbar-button"
          onMouseDown={keepFocus}
          onClick={() => onSort(true)}
          aria-label="Sort descending"
          title="Sort Z → A, largest first"
        >
          {SORT_DESCENDING}
        </button>
        <MenuButton label="Rows and columns" options={STRUCTURE_OPTIONS} onSelect={(value) => onStructure(value as StructureCommand)}>
          {ROWS_ICON}
        </MenuButton>
      </div>
    </div>
  );
}
