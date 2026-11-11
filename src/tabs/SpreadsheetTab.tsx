import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent,
  type KeyboardEvent,
  type MouseEvent,
} from "react";
import { addressKey, formatRangeReference } from "./spreadsheet/address";
import { encodeTsv, parseTsv } from "./spreadsheet/clipboard";
import { CELL_HEIGHT, CELL_WIDTH, COL_HEADER_HEIGHT, MAX_COLS, MAX_ROWS, ROW_HEADER_WIDTH } from "./spreadsheet/constants";
import { computeFillTarget, unionBounds } from "./spreadsheet/fill";
import {
  cycleAbsolute,
  functionTokenAt,
  isFormula,
  normalizeCellInput,
  refInsertionSpan,
  replaceSpan,
  suggestFunctions,
} from "./spreadsheet/formulaEdit";
import { parseFormulaRefs } from "./spreadsheet/formulaRefs";
import FormulaBar from "./spreadsheet/FormulaBar";
import FunctionSuggestions from "./spreadsheet/FunctionSuggestions";
import { buildGeometry, colAt, rectFor, rowAt } from "./spreadsheet/geometry";
import Grid from "./spreadsheet/Grid";
import { EMPTY_HISTORY, peekRedo, peekUndo, pushHistory, stepHistory, type History } from "./spreadsheet/history";
import { jumpTarget, lastUsedCell } from "./spreadsheet/navigation";
import {
  autoToNumberFormat,
  defaultDecimals,
  formatPlainNumber,
  MAX_DECIMALS,
  type NumberFormat,
} from "./spreadsheet/numberFormat";
import { buildDocument, loadDocumentFromStorage, saveDocumentToStorage } from "./spreadsheet/persistence";
import { normalizeRange, singleCellRange, type RangeBounds } from "./spreadsheet/range";
import { buildSheetView } from "./spreadsheet/sheetView";
import "./spreadsheet/SpreadsheetTab.css";
import { summarize } from "./spreadsheet/summary";
import Toolbar from "./spreadsheet/Toolbar";
import type { CellAddress, CellFormat, CellRange, EditingState } from "./spreadsheet/types";
import { useCellFormatting, type FormatChange, type FormatSnapshot } from "./spreadsheet/useCellFormatting";
import { clampWidth, useColumnWidths } from "./spreadsheet/useColumnWidths";
import { useSpreadsheetEngine } from "./spreadsheet/useSpreadsheetEngine";
import { clamp } from "./spreadsheet/utils";
import { useToast } from "../ToastContext";

const rows = MAX_ROWS;
const cols = MAX_COLS;

// What a mouse drag is currently doing. "cols"/"rows" are drags that
// started on a header and select whole columns/rows.
type DragMode = "select" | "cols" | "rows" | "fill" | "formula-ref" | null;

// A cell reference picked into the formula being edited (with the mouse or
// the arrow keys), and the stretch of the formula's text it occupies — so
// dragging or arrowing on replaces it in place instead of appending.
interface RefPick {
  anchor: CellAddress;
  focus: CellAddress;
  start: number;
  end: number;
}

// The "marching ants" range. `text` is exactly what was put on the system
// clipboard: a paste whose text still matches came from this range, and is
// pasted as formulas + formatting rather than as plain values.
interface CopiedRange {
  bounds: RangeBounds;
  cut: boolean;
  text: string;
}

const AUTOSAVE_DEBOUNCE_MS = 500;
const AUTOSCROLL_INTERVAL_MS = 40;
const AUTOSCROLL_STEP = 18;

const sameCell = (a: CellAddress, b: CellAddress) => a.row === b.row && a.col === b.col;
const toRange = (bounds: RangeBounds): CellRange => ({
  anchor: { row: bounds.minRow, col: bounds.minCol },
  focus: { row: bounds.maxRow, col: bounds.maxCol },
});
const normalizeNewlines = (text: string) => text.replace(/\r\n?/g, "\n").replace(/\n$/, "");

interface SpreadsheetTabProps {
  // False while the Calculator tab is showing. The tab stays mounted (so
  // undo history, selection and scroll position survive a tab switch); it
  // just mustn't grab focus while hidden.
  active: boolean;
}

export default function SpreadsheetTab({ active }: SpreadsheetTabProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const cellInputRef = useRef<HTMLInputElement>(null);
  const barInputRef = useRef<HTMLInputElement>(null);
  const showToast = useToast();

  // The autosaved document is read once, synchronously, and handed to the
  // three stores as their initial state — there is never a moment where
  // they're empty and an autosave could write that emptiness back out.
  const [saved] = useState(loadDocumentFromStorage);
  const engine = useSpreadsheetEngine(saved?.cells ?? {});
  const formatting = useCellFormatting(saved?.formats ?? {});
  const columnWidths = useColumnWidths(saved?.columnWidths ?? {});

  const [selection, setSelection] = useState<CellRange>(singleCellRange({ row: 0, col: 0 }));
  const [editing, setEditing] = useState<EditingState | null>(null);
  const [dragMode, setDragMode] = useState<DragMode>(null);
  // Cells a fill-handle drag would write to right now (any direction, see
  // fill.ts), or null while the cursor is still inside the selection.
  const [fillTarget, setFillTarget] = useState<RangeBounds | null>(null);
  const [copied, setCopied] = useState<CopiedRange | null>(null);
  const [refPick, setRefPick] = useState<RefPick | null>(null);
  // Set after the formula text is changed programmatically (a picked
  // reference, an accepted suggestion, F4) so an effect can put the input's
  // caret there once the new value has landed in the DOM.
  const [pendingCaret, setPendingCaret] = useState<number | null>(null);
  const [history, setHistory] = useState<History>(EMPTY_HISTORY);
  // Function autocomplete: highlighted row, whether the user has moved it
  // (only then does Enter accept instead of committing), and whether Escape
  // dismissed the list for the word being typed.
  const [suggestIndex, setSuggestIndex] = useState(0);
  const [suggestTouched, setSuggestTouched] = useState(false);
  const [suggestDismissed, setSuggestDismissed] = useState(false);
  const [suggestPosition, setSuggestPosition] = useState<{ left: number; top: number } | null>(null);
  // Column a run of Tab presses started in: Enter then returns to it on the
  // next row, which is how Excel makes typing a table row by row work.
  const tabOriginRef = useRef<number | null>(null);

  const activeCell = selection.anchor;
  const selectionBounds = normalizeRange(selection);
  const geometry = useMemo(() => buildGeometry(columnWidths.getWidth, rows, cols), [columnWidths.getWidth]);
  const view = useMemo(() => buildSheetView(engine, formatting.formats, rows, cols), [engine, formatting.formats]);

  // ---------------------------------------------------------------- autosave

  // Debounced so a burst of edits doesn't write on every one; flushed
  // immediately on window hide / app quit / unload so the last edits aren't
  // lost to the debounce interval.
  const latestRef = useRef({ engine, formats: formatting.formats, widths: columnWidths.widths });
  latestRef.current = { engine, formats: formatting.formats, widths: columnWidths.widths };
  const savedStateRef = useRef({ revision: engine.revision, formats: formatting.formats, widths: columnWidths.widths });
  const savePendingRef = useRef(false);
  const flushSave = useCallback(() => {
    if (!savePendingRef.current) return;
    savePendingRef.current = false;
    const latest = latestRef.current;
    saveDocumentToStorage(buildDocument(latest.engine.exportCells(), latest.formats, latest.widths));
    savedStateRef.current = { revision: latest.engine.revision, formats: latest.formats, widths: latest.widths };
  }, []);

  useEffect(() => {
    const last = savedStateRef.current;
    if (
      last.revision === engine.revision &&
      last.formats === formatting.formats &&
      last.widths === columnWidths.widths
    ) {
      return; // nothing changed since the last save (including: just loaded)
    }
    savePendingRef.current = true;
    const timeoutId = window.setTimeout(flushSave, AUTOSAVE_DEBOUNCE_MS);
    return () => window.clearTimeout(timeoutId);
  }, [engine.revision, formatting.formats, columnWidths.widths, flushSave]);

  useEffect(() => {
    window.addEventListener("beforeunload", flushSave);
    window.addEventListener("pagehide", flushSave);
    const unsubscribe = window.electronAPI?.onWindowHiding(flushSave);
    return () => {
      window.removeEventListener("beforeunload", flushSave);
      window.removeEventListener("pagehide", flushSave);
      unsubscribe?.();
      flushSave();
    };
  }, [flushSave]);

  // ------------------------------------------------------------------- focus

  // Keep keyboard focus on the grid whenever nothing is being edited:
  // committing/canceling an edit removes its <input>, which would otherwise
  // drop focus to the document body and kill the arrow keys.
  useEffect(() => {
    if (active && !editing) containerRef.current?.focus({ preventScroll: true });
  }, [editing, active]);

  // Re-focus when the window is shown again (hide/show doesn't remount).
  useEffect(() => {
    if (!active) return;
    return window.electronAPI?.onWindowShown(() => {
      const focused = document.activeElement;
      if (focused instanceof HTMLInputElement || focused instanceof HTMLSelectElement) return;
      containerRef.current?.focus({ preventScroll: true });
    });
  }, [active]);

  const activeInput = () => (editing?.source === "formula-bar" ? barInputRef.current : cellInputRef.current);

  useEffect(() => {
    if (pendingCaret === null) return;
    const input = editing?.source === "formula-bar" ? barInputRef.current : cellInputRef.current;
    if (input) {
      input.focus();
      input.setSelectionRange(pendingCaret, pendingCaret);
    }
    setPendingCaret(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingCaret]);

  // -------------------------------------------------------------- selection

  // Scrolls just far enough to bring a cell out from under the sticky
  // headers / into the viewport. Called by keyboard navigation only — mouse
  // selection never moves the view under the cursor.
  function reveal(address: CellAddress) {
    const container = containerRef.current;
    if (!container) return;
    const rect = rectFor(
      { minRow: address.row, maxRow: address.row, minCol: address.col, maxCol: address.col },
      geometry,
    );
    if (rect.left < container.scrollLeft + ROW_HEADER_WIDTH) {
      container.scrollLeft = rect.left - ROW_HEADER_WIDTH;
    } else if (rect.left + rect.width > container.scrollLeft + container.clientWidth) {
      container.scrollLeft = rect.left + rect.width - container.clientWidth;
    }
    if (rect.top < container.scrollTop + COL_HEADER_HEIGHT) {
      container.scrollTop = rect.top - COL_HEADER_HEIGHT;
    } else if (rect.top + rect.height > container.scrollTop + container.clientHeight) {
      container.scrollTop = rect.top + rect.height - container.clientHeight;
    }
  }

  function selectAndReveal(range: CellRange, keepTabOrigin = false) {
    if (!keepTabOrigin) tabOriginRef.current = null;
    setSelection(range);
    reveal(range.focus);
  }

  const clampCell = (row: number, col: number): CellAddress => ({
    row: clamp(row, 0, rows - 1),
    col: clamp(col, 0, cols - 1),
  });

  // Arrow-key movement. `extend` (Shift) grows the selection from its
  // anchor; `jump` (Cmd) goes to the edge of the current block of data.
  function navigate(deltaRow: number, deltaCol: number, extend: boolean, jump: boolean) {
    const from = extend ? selection.focus : selection.anchor;
    const target = jump
      ? jumpTarget(engine.isEmpty, from, deltaRow, deltaCol, rows, cols)
      : clampCell(from.row + deltaRow, from.col + deltaCol);
    selectAndReveal(extend ? { anchor: selection.anchor, focus: target } : singleCellRange(target));
  }

  // Where Enter / Tab go after committing (or on their own).
  function step(direction: "down" | "up" | "right" | "left") {
    const from = selection.anchor;
    if (direction === "right" || direction === "left") {
      if (tabOriginRef.current === null) tabOriginRef.current = from.col;
      selectAndReveal(singleCellRange(clampCell(from.row, from.col + (direction === "right" ? 1 : -1))), true);
      return;
    }
    const col = direction === "down" && tabOriginRef.current !== null ? tabOriginRef.current : from.col;
    selectAndReveal(singleCellRange(clampCell(from.row + (direction === "down" ? 1 : -1), col)));
  }

  function selectedAddresses(): CellAddress[] {
    const addresses: CellAddress[] = [];
    for (let row = selectionBounds.minRow; row <= selectionBounds.maxRow; row++) {
      for (let col = selectionBounds.minCol; col <= selectionBounds.maxCol; col++) {
        addresses.push({ row, col });
      }
    }
    return addresses;
  }

  // ----------------------------------------------------------------- history

  // Records one undo-able action. `content` must be true exactly when the
  // engine took one undo step for it (see history.ts).
  function record(change: { content: boolean; format?: FormatChange }, keepCopied = false) {
    const format = change.format && Object.keys(change.format.after).length > 0 ? change.format : undefined;
    if (!change.content && !format) return;
    setHistory((prev) => pushHistory(prev, { content: change.content, format, selection }));
    // Like Excel, changing the sheet ends "copy mode": the dashed outline
    // goes away and a later paste brings in plain values.
    if (!keepCopied) setCopied(null);
  }

  function performUndo() {
    const entry = peekUndo(history);
    if (!entry) return;
    if (entry.content) engine.undo();
    if (entry.format) formatting.restore(entry.format.before);
    setHistory((prev) => stepHistory(prev, -1));
    setCopied(null);
    selectAndReveal(entry.selection);
  }

  function performRedo() {
    const entry = peekRedo(history);
    if (!entry) return;
    if (entry.content) engine.redo();
    if (entry.format) formatting.restore(entry.format.after);
    setHistory((prev) => stepHistory(prev, 1));
    setCopied(null);
    selectAndReveal(entry.selection);
  }

  // ----------------------------------------------------------------- editing

  function startEdit(address: CellAddress, value: string, source: EditingState["source"], mode: EditingState["mode"]) {
    setSelection(singleCellRange(address));
    setEditing({ address, value, source, mode, caret: value.length });
    setRefPick(null);
    setSuggestIndex(0);
    setSuggestTouched(false);
    setSuggestDismissed(false);
    if (source === "cell") reveal(address);
  }

  function endEdit() {
    setEditing(null);
    setRefPick(null);
    if (dragMode === "formula-ref") setDragMode(null);
  }

  function commitEdit(move: "down" | "up" | "right" | "left" | null) {
    if (!editing) return;
    // Committing text that's already what the cell holds isn't an edit, and
    // mustn't leave a do-nothing step in the undo history.
    if (normalizeCellInput(editing.value) !== engine.raw(editing.address)) {
      engine.setCell(editing.address, editing.value);
      record({ content: true });
    }
    endEdit();
    if (move) step(move);
  }

  function setEditText(value: string, caret: number) {
    setEditing((prev) => (prev ? { ...prev, value, caret } : prev));
    setPendingCaret(caret);
  }

  // Typing in either input (the in-cell editor or the formula bar).
  function handleEditValueChange(value: string, caret: number) {
    setEditing((prev) => (prev ? { ...prev, value, caret } : prev));
    setRefPick(null);
    setSuggestIndex(0);
    setSuggestTouched(false);
    setSuggestDismissed(false);
  }

  function handleEditCaretChange(caret: number) {
    setEditing((prev) => (prev && prev.caret !== caret ? { ...prev, caret } : prev));
  }

  // Clicking into the text being edited: from here on the arrow keys move
  // the caret rather than picking cells.
  function handleEditorMouseDown() {
    setRefPick(null);
    setEditing((prev) => (prev && prev.mode !== "edit" ? { ...prev, mode: "edit" } : prev));
  }

  // Starting an edit from the formula bar (vs. double-click/typing on the
  // cell) is what makes the in-cell editor *not* steal DOM focus back.
  function handleFormulaBarFocus() {
    if (!editing) startEdit(activeCell, engine.raw(activeCell), "formula-bar", "edit");
  }

  // Writes a picked reference into the formula, replacing whatever span of
  // text the pick currently occupies.
  function applyPick(pick: RefPick) {
    if (!editing) return;
    const text = formatRangeReference({ anchor: pick.anchor, focus: pick.focus });
    const value = replaceSpan(editing.value, pick, text);
    const end = pick.start + text.length;
    setEditing({ ...editing, value, caret: end });
    setRefPick({ ...pick, end });
    setPendingCaret(end);
  }

  // Arrow keys while editing a formula ("point mode"): right after an
  // operator, or while a picked reference is still live, the arrows move a
  // cell cursor and write its address into the formula. Returns false when
  // the arrows should do something else.
  function keyboardPick(deltaRow: number, deltaCol: number, extend: boolean): boolean {
    if (!editing || !isFormula(editing.value)) return false;
    let pick = refPick;
    if (!pick) {
      if (editing.mode !== "enter") return false;
      const input = activeInput();
      const start = input?.selectionStart ?? editing.value.length;
      const end = input?.selectionEnd ?? start;
      const span = start === end ? refInsertionSpan(editing.value, start, end) : null;
      if (!span || span.start !== span.end) return false;
      pick = { anchor: editing.address, focus: editing.address, ...span };
    }
    const focus = clampCell(pick.focus.row + deltaRow, pick.focus.col + deltaCol);
    applyPick(extend ? { ...pick, focus } : { ...pick, anchor: focus, focus });
    reveal(focus);
    return true;
  }

  // ------------------------------------------------- function autocomplete

  const token = editing && !refPick && !suggestDismissed ? functionTokenAt(editing.value, editing.caret) : null;
  const suggestions = useMemo(
    () => (token ? suggestFunctions(token.token, engine.functionNames) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [token?.token, engine.functionNames],
  );
  const suggestionsKey = suggestions.join(",");

  function acceptSuggestion(name: string) {
    if (!editing || !token) return;
    const hasParen = editing.value[editing.caret] === "(";
    const insert = hasParen ? name : `${name}(`;
    const value = replaceSpan(editing.value, { start: token.start, end: editing.caret }, insert);
    setEditText(value, token.start + insert.length + (hasParen ? 1 : 0));
    setSuggestIndex(0);
    setSuggestTouched(false);
  }

  // Anchored under (or, with no room, above) whichever input is in use.
  useLayoutEffect(() => {
    if (suggestions.length === 0) {
      setSuggestPosition(null);
      return;
    }
    const input = editing?.source === "formula-bar" ? barInputRef.current : cellInputRef.current;
    if (!input) return;
    const rect = input.getBoundingClientRect();
    const height = suggestions.length * 24 + 10;
    const fitsBelow = rect.bottom + 4 + height <= window.innerHeight;
    setSuggestPosition({
      left: Math.max(4, Math.min(rect.left, window.innerWidth - 264)),
      top: fitsBelow ? rect.bottom + 4 : Math.max(4, rect.top - 4 - height),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [suggestionsKey, editing?.source, editing?.address.row, editing?.address.col]);

  // --------------------------------------------------- fill / clipboard / clear

  // The formats a block copied from `source` gives `target`, repeating the
  // source like the content does.
  function formatsFor(source: RangeBounds, target: RangeBounds, fill = false): FormatSnapshot {
    // Same alignment as the engine's content (see copyInto): a fill carries
    // the pattern on from the source, a paste restarts it at the target.
    const origin = fill ? source : target;
    const height = source.maxRow - source.minRow + 1;
    const width = source.maxCol - source.minCol + 1;
    const changes: FormatSnapshot = {};
    for (let row = target.minRow; row <= target.maxRow; row++) {
      for (let col = target.minCol; col <= target.maxCol; col++) {
        const from = {
          row: source.minRow + ((((row - origin.minRow) % height) + height) % height),
          col: source.minCol + ((((col - origin.minCol) % width) + width) % width),
        };
        changes[addressKey({ row, col })] = formatting.formats[addressKey(from)];
      }
    }
    return changes;
  }

  function commitFill(target: RangeBounds) {
    engine.copyInto(selectionBounds, target, true);
    const format = formatting.setMany(formatsFor(selectionBounds, target, true));
    record({ content: true, format });
    setSelection(toRange(unionBounds(selectionBounds, target)));
  }

  function clearSelection() {
    if (selectedAddresses().every((address) => engine.isEmpty(address))) return;
    engine.clear(selectionBounds);
    record({ content: true });
  }

  function selectionAsText(): string {
    const matrix: string[][] = [];
    for (let row = selectionBounds.minRow; row <= selectionBounds.maxRow; row++) {
      const line: string[] = [];
      for (let col = selectionBounds.minCol; col <= selectionBounds.maxCol; col++) {
        line.push(view.cells[addressKey({ row, col })]?.text ?? "");
      }
      matrix.push(line);
    }
    return encodeTsv(matrix);
  }

  // Copy, cut and paste are driven from the keyboard handler (and the
  // context menu) through the async clipboard API. The DOM clipboard events
  // are handled as well, for anything that raises them instead — the Edit
  // menu's roles in Electron, a browser's own menu.
  function copySelection(cut: boolean): string {
    const text = selectionAsText();
    setCopied({ bounds: selectionBounds, cut, text: normalizeNewlines(text) });
    return text;
  }

  function copyToClipboard(cut: boolean) {
    const text = copySelection(cut);
    navigator.clipboard?.writeText(text).catch(() => {
      // Still copied within the sheet; it just didn't reach other apps.
    });
  }

  function pasteFromClipboard() {
    const fallback = copied?.text ?? null;
    const read = navigator.clipboard?.readText ? navigator.clipboard.readText() : Promise.reject(new Error("unavailable"));
    read
      .then((text) => pasteTextRef.current(text))
      .catch(() => {
        // Clipboard access refused: a range copied in this sheet can still
        // be pasted.
        if (fallback !== null) pasteTextRef.current(fallback);
      });
  }

  const fromTextField = (e: ClipboardEvent) =>
    editing !== null || e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement;

  function handleCopy(e: ClipboardEvent, cut: boolean) {
    if (fromTextField(e)) return;
    e.preventDefault();
    e.clipboardData.setData("text/plain", copySelection(cut));
  }

  function handlePaste(e: ClipboardEvent) {
    if (fromTextField(e)) return;
    e.preventDefault();
    pasteText(e.clipboardData.getData("text/plain"));
  }

  function pasteText(text: string) {
    const topLeft = { row: selectionBounds.minRow, col: selectionBounds.minCol };

    if (copied && normalizeNewlines(text) === copied.text) {
      const source = copied.bounds;
      const height = source.maxRow - source.minRow + 1;
      const width = source.maxCol - source.minCol + 1;

      if (copied.cut) {
        const target: RangeBounds = {
          minRow: topLeft.row,
          maxRow: topLeft.row + height - 1,
          minCol: topLeft.col,
          maxCol: topLeft.col + width - 1,
        };
        if (!engine.move(source, topLeft)) {
          showToast("Doesn't fit there");
          return;
        }
        // Formats move with the cells: clear the source, then set the target
        // (in that order, so an overlapping move keeps the right ones).
        const changes: FormatSnapshot = {};
        for (let row = source.minRow; row <= source.maxRow; row++) {
          for (let col = source.minCol; col <= source.maxCol; col++) changes[addressKey({ row, col })] = undefined;
        }
        Object.assign(changes, formatsFor(source, target));
        record({ content: true, format: formatting.setMany(changes) });
        setSelection(toRange(target));
        return;
      }

      // One copied cell (or block) pasted over a larger selection that it
      // divides evenly fills the whole selection.
      const selHeight = selectionBounds.maxRow - selectionBounds.minRow + 1;
      const selWidth = selectionBounds.maxCol - selectionBounds.minCol + 1;
      const tiles = selHeight % height === 0 && selWidth % width === 0;
      const target: RangeBounds = {
        minRow: topLeft.row,
        maxRow: Math.min(rows - 1, topLeft.row + (tiles ? selHeight : height) - 1),
        minCol: topLeft.col,
        maxCol: Math.min(cols - 1, topLeft.col + (tiles ? selWidth : width) - 1),
      };
      engine.copyInto(source, target);
      record({ content: true, format: formatting.setMany(formatsFor(source, target)) }, true);
      setSelection(toRange(target));
      return;
    }

    // Text from anywhere else (another app, the calculator tab, or this
    // sheet after it changed): tab-separated values, pasted as typed input.
    let values = parseTsv(text);
    if (values.length === 0) return;
    const isSingle = values.length === 1 && values[0].length === 1;
    if (isSingle && (selectionBounds.maxRow > selectionBounds.minRow || selectionBounds.maxCol > selectionBounds.minCol)) {
      values = Array.from({ length: selectionBounds.maxRow - selectionBounds.minRow + 1 }, () =>
        Array.from({ length: selectionBounds.maxCol - selectionBounds.minCol + 1 }, () => values[0][0]),
      );
    }
    const written = engine.setMatrix(topLeft, values);
    if (!written) return;
    record({ content: true });
    setSelection(toRange(written));
  }

  const pasteTextRef = useRef(pasteText);
  pasteTextRef.current = pasteText;

  // Commands from the grid's native context menu (Electron) come back over
  // IPC. A ref, so the one subscription always runs the current handlers.
  const menuCommandRef = useRef<(command: string) => void>(() => {});
  menuCommandRef.current = (command) => {
    if (editing) return;
    if (command === "copy") copyToClipboard(false);
    else if (command === "cut") copyToClipboard(true);
    else if (command === "paste") pasteFromClipboard();
    else if (command === "clear") clearSelection();
  };
  useEffect(() => {
    if (!active) return;
    return window.electronAPI?.onMenuCommand?.((command) => menuCommandRef.current(command));
  }, [active]);

  // -------------------------------------------------------------- formatting

  function applyToggle(property: "bold" | "italic") {
    const addresses = selectedAddresses();
    const allSet = addresses.every((address) => formatting.getFormat(address)[property] === true);
    const format = formatting.applyFormat(addresses, (current) => ({
      ...current,
      [property]: allSet ? undefined : true,
    }));
    record({ content: false, format }, true);
  }

  function handleSetFill(color: string) {
    const addresses = selectedAddresses();
    const allSameFill = addresses.every((address) => formatting.getFormat(address).fill === color);
    const format = formatting.applyFormat(addresses, (current) => ({
      ...current,
      fill: allSameFill ? undefined : color,
    }));
    record({ content: false, format }, true);
  }

  function handleSetNumberFormat(numberFormat: NumberFormat | "general") {
    const format = formatting.applyFormat(selectedAddresses(), (current) => ({
      ...current,
      numberFormat: numberFormat === "general" ? undefined : numberFormat,
      // Switching format starts from that format's default precision.
      decimals: undefined,
    }));
    record({ content: false, format }, true);
    containerRef.current?.focus({ preventScroll: true });
  }

  // Excel-style: "more decimals" on a General cell turns it into a plain
  // Number first (or keeps it the currency/percentage it was typed as), so
  // the button always does something visible.
  function handleChangeDecimals(delta: 1 | -1) {
    const format = formatting.applyFormat(selectedAddresses(), (current, address) => {
      const numberFormat =
        current.numberFormat ?? autoToNumberFormat(view.cells[addressKey(address)]?.auto ?? null) ?? "number";
      const base = current.decimals ?? defaultDecimals(numberFormat);
      return { ...current, numberFormat, decimals: clamp(base + delta, 0, MAX_DECIMALS) };
    });
    record({ content: false, format }, true);
  }

  // Double-click on a column's resize edge: size it to its widest content
  // (measured in the grid's own font), within the min/max width limits.
  function handleColumnAutoFit(col: number) {
    const grid = gridRef.current;
    const context = document.createElement("canvas").getContext("2d");
    if (!grid || !context) return;
    const style = getComputedStyle(grid);
    let widest = 0;
    for (const cell of Object.values(view.cells)) {
      if (cell.col !== col) continue;
      const cellFormat = formatting.formats[addressKey(cell)];
      context.font = `${cellFormat?.bold ? "600 " : ""}${style.fontSize} ${style.fontFamily}`;
      widest = Math.max(widest, context.measureText(cell.text).width);
    }
    // An empty column has nothing to fit to: reset it to the default width
    // (like Excel) rather than collapsing it to the minimum.
    columnWidths.setWidth(col, widest === 0 ? CELL_WIDTH : clampWidth(widest + 14));
  }

  // -------------------------------------------------------------------- mouse

  // Which part of the grid a point is over. Headers are sticky, so they're
  // found relative to the scroll container; the cell from the grid itself.
  function hitTest(clientX: number, clientY: number) {
    const container = containerRef.current;
    const grid = gridRef.current;
    if (!container || !grid) return null;
    const containerRect = container.getBoundingClientRect();
    const gridRect = grid.getBoundingClientRect();
    const overColHeader = clientY - containerRect.top < COL_HEADER_HEIGHT;
    const overRowHeader = clientX - containerRect.left < ROW_HEADER_WIDTH;
    return {
      zone: overColHeader && overRowHeader ? "corner" : overColHeader ? "col" : overRowHeader ? "row" : "cell",
      address: { row: rowAt(clientY - gridRect.top, rows), col: colAt(clientX - gridRect.left, geometry) },
      // Inside the scrollable area itself, not on a (classic) scrollbar.
      inside:
        clientX < containerRect.left + container.clientWidth && clientY < containerRect.top + container.clientHeight,
    } as const;
  }

  function handleGridMouseDown(e: MouseEvent) {
    if (e.target instanceof HTMLInputElement) return; // the in-cell editor handles its own clicks
    const hit = hitTest(e.clientX, e.clientY);
    if (!hit || !hit.inside) return;
    const { zone, address } = hit;

    // Right-click: keep a selection the click landed inside (so the context
    // menu acts on it), otherwise select the cell under the cursor.
    if (e.button === 2) {
      if (editing) return;
      const inSelection =
        address.row >= selectionBounds.minRow &&
        address.row <= selectionBounds.maxRow &&
        address.col >= selectionBounds.minCol &&
        address.col <= selectionBounds.maxCol;
      if (zone === "cell" && !inSelection) setSelection(singleCellRange(address));
      containerRef.current?.focus({ preventScroll: true });
      return;
    }
    if (e.button !== 0) return;

    if (editing) {
      if (zone === "cell" && sameCell(editing.address, address) && editing.source === "cell") return;
      if (zone === "cell" && isFormula(editing.value)) {
        // Shift+click stretches the reference just picked into a range.
        if (e.shiftKey && refPick) {
          e.preventDefault();
          applyPick({ ...refPick, focus: address });
          return;
        }
        const input = activeInput();
        const start = input?.selectionStart ?? editing.value.length;
        const span = refInsertionSpan(editing.value, start, input?.selectionEnd ?? start);
        if (span) {
          e.preventDefault(); // keep focus (and the caret) in the input
          applyPick({ anchor: address, focus: address, ...span });
          setDragMode("formula-ref");
          return;
        }
      }
      commitEdit(null);
    }

    tabOriginRef.current = null;
    containerRef.current?.focus({ preventScroll: true });
    e.preventDefault();

    if (zone === "corner") {
      setSelection({ anchor: { row: 0, col: 0 }, focus: { row: rows - 1, col: cols - 1 } });
    } else if (zone === "col") {
      const anchorCol = e.shiftKey ? selection.anchor.col : address.col;
      setSelection({ anchor: { row: 0, col: anchorCol }, focus: { row: rows - 1, col: address.col } });
      setDragMode("cols");
    } else if (zone === "row") {
      const anchorRow = e.shiftKey ? selection.anchor.row : address.row;
      setSelection({ anchor: { row: anchorRow, col: 0 }, focus: { row: address.row, col: cols - 1 } });
      setDragMode("rows");
    } else {
      setSelection(e.shiftKey ? { anchor: selection.anchor, focus: address } : singleCellRange(address));
      setDragMode("select");
    }
  }

  function handleGridDoubleClick(e: MouseEvent) {
    if (e.target instanceof HTMLInputElement) return;
    const hit = hitTest(e.clientX, e.clientY);
    if (!hit || !hit.inside || hit.zone !== "cell" || editing) return;
    startEdit(hit.address, engine.raw(hit.address), "cell", "edit");
  }

  function handleFillHandleMouseDown(e: MouseEvent) {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    setDragMode("fill");
    setFillTarget(null);
  }

  function handleContextMenu(e: MouseEvent) {
    if (e.target instanceof HTMLInputElement) return; // text fields get the standard edit menu
    e.preventDefault();
    window.electronAPI?.showGridMenu?.();
  }

  // What a drag does as the pointer moves. Kept in a ref so the window-level
  // listeners below always call the version that sees current state.
  function dragTo(clientX: number, clientY: number) {
    const hit = hitTest(clientX, clientY);
    if (!hit) return;
    const { address } = hit;
    if (dragMode === "select") {
      setSelection((prev) => (sameCell(prev.focus, address) ? prev : { ...prev, focus: address }));
    } else if (dragMode === "cols") {
      setSelection((prev) => (prev.focus.col === address.col ? prev : { ...prev, focus: { row: rows - 1, col: address.col } }));
    } else if (dragMode === "rows") {
      setSelection((prev) => (prev.focus.row === address.row ? prev : { ...prev, focus: { row: address.row, col: cols - 1 } }));
    } else if (dragMode === "fill") {
      setFillTarget(computeFillTarget(selectionBounds, address, rows, cols));
    } else if (dragMode === "formula-ref" && refPick && !sameCell(refPick.focus, address)) {
      applyPick({ ...refPick, focus: address });
    }
  }

  function finishDrag() {
    if (dragMode === "fill" && fillTarget !== null) commitFill(fillTarget);
    setDragMode(null);
    setFillTarget(null);
  }

  const dragToRef = useRef(dragTo);
  dragToRef.current = dragTo;
  const finishDragRef = useRef(finishDrag);
  finishDragRef.current = finishDrag;

  // A drag is tracked on the window (it can leave the grid, or end outside
  // it), and scrolls the grid when held past an edge.
  useEffect(() => {
    if (!dragMode) return;
    let pointer: { x: number; y: number } | null = null;

    function handleMove(e: globalThis.MouseEvent) {
      pointer = { x: e.clientX, y: e.clientY };
      dragToRef.current(pointer.x, pointer.y);
    }
    function handleUp() {
      finishDragRef.current();
    }
    const scrollTimer = window.setInterval(() => {
      const container = containerRef.current;
      if (!pointer || !container) return;
      const rect = container.getBoundingClientRect();
      let dx = 0;
      let dy = 0;
      if (dragMode !== "rows") {
        if (pointer.x > rect.right - 6) dx = AUTOSCROLL_STEP;
        else if (pointer.x < rect.left + ROW_HEADER_WIDTH) dx = -AUTOSCROLL_STEP;
      }
      if (dragMode !== "cols") {
        if (pointer.y > rect.bottom - 6) dy = AUTOSCROLL_STEP;
        else if (pointer.y < rect.top + COL_HEADER_HEIGHT) dy = -AUTOSCROLL_STEP;
      }
      if (dx === 0 && dy === 0) return;
      const before = { left: container.scrollLeft, top: container.scrollTop };
      container.scrollLeft += dx;
      container.scrollTop += dy;
      if (container.scrollLeft !== before.left || container.scrollTop !== before.top) {
        dragToRef.current(pointer.x, pointer.y);
      }
    }, AUTOSCROLL_INTERVAL_MS);

    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);
    return () => {
      window.clearInterval(scrollTimer);
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
    };
  }, [dragMode]);

  // ----------------------------------------------------------------- keyboard

  const ARROWS: Record<string, [number, number]> = {
    ArrowUp: [-1, 0],
    ArrowDown: [1, 0],
    ArrowLeft: [0, -1],
    ArrowRight: [0, 1],
  };

  function handleEditingKeyDown(e: KeyboardEvent<HTMLElement>) {
    if (!editing) return;
    const listOpen = suggestions.length > 0;
    const mod = e.metaKey || e.ctrlKey;

    switch (e.key) {
      case "Enter":
        e.preventDefault();
        if (listOpen && suggestTouched) acceptSuggestion(suggestions[suggestIndex]);
        else commitEdit(mod ? null : e.shiftKey ? "up" : "down");
        return;
      case "Tab":
        e.preventDefault();
        if (listOpen) acceptSuggestion(suggestions[suggestIndex]);
        else commitEdit(e.shiftKey ? "left" : "right");
        return;
      case "Escape":
        e.preventDefault();
        // Specific enough that Escape shouldn't also fall through to
        // App.tsx's window-hide fallback.
        e.stopPropagation();
        if (listOpen) setSuggestDismissed(true);
        else endEdit();
        return;
      case "F2":
        e.preventDefault();
        setRefPick(null);
        setEditing({ ...editing, mode: editing.mode === "enter" ? "edit" : "enter" });
        return;
      case "F4": {
        e.preventDefault();
        const input = activeInput();
        const cycled = cycleAbsolute(editing.value, input?.selectionStart ?? editing.caret);
        if (cycled) {
          setRefPick(null);
          setEditText(cycled.value, cycled.caret);
        }
        return;
      }
    }

    const arrow = ARROWS[e.key];
    if (!arrow || mod || e.altKey) return;
    if (listOpen && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
      e.preventDefault();
      const count = suggestions.length;
      setSuggestIndex((index) => (index + (e.key === "ArrowDown" ? 1 : count - 1)) % count);
      setSuggestTouched(true);
      return;
    }
    if (keyboardPick(arrow[0], arrow[1], e.shiftKey)) {
      e.preventDefault();
      return;
    }
    // Typed straight over a cell (not F2/double-click): arrows finish the
    // entry and move on, which is what makes filling in a table quick.
    if (editing.mode === "enter" && !e.shiftKey) {
      e.preventDefault();
      const direction = ({ ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right" } as const)[
        e.key as "ArrowUp" | "ArrowDown" | "ArrowLeft" | "ArrowRight"
      ];
      commitEdit(null);
      tabOriginRef.current = null;
      const from = editing.address;
      selectAndReveal(
        singleCellRange(
          clampCell(
            from.row + (direction === "down" ? 1 : direction === "up" ? -1 : 0),
            from.col + (direction === "right" ? 1 : direction === "left" ? -1 : 0),
          ),
        ),
      );
    }
  }

  function handleKeyDown(e: KeyboardEvent<HTMLElement>) {
    if (editing) {
      handleEditingKeyDown(e);
      return;
    }
    // Keys pressed in the toolbar's own controls belong to those controls.
    if (e.target instanceof HTMLSelectElement || e.target instanceof HTMLButtonElement) return;

    const mod = e.metaKey || e.ctrlKey;
    const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;

    if (mod && !e.altKey) {
      switch (key) {
        case "c":
          e.preventDefault();
          copyToClipboard(false);
          return;
        case "x":
          e.preventDefault();
          copyToClipboard(true);
          return;
        case "v":
          e.preventDefault();
          pasteFromClipboard();
          return;
        case "z":
          e.preventDefault();
          if (e.shiftKey) performRedo();
          else performUndo();
          return;
        case "y":
          e.preventDefault();
          performRedo();
          return;
        case "b":
          e.preventDefault();
          applyToggle("bold");
          return;
        case "i":
          e.preventDefault();
          applyToggle("italic");
          return;
        case "a":
          e.preventDefault();
          setSelection({ anchor: { row: 0, col: 0 }, focus: { row: rows - 1, col: cols - 1 } });
          return;
        case "Home":
          e.preventDefault();
          selectAndReveal(e.shiftKey ? { anchor: selection.anchor, focus: { row: 0, col: 0 } } : singleCellRange({ row: 0, col: 0 }));
          return;
        case "End": {
          e.preventDefault();
          const last = lastUsedCell(engine.isEmpty, rows, cols);
          selectAndReveal(e.shiftKey ? { anchor: selection.anchor, focus: last } : singleCellRange(last));
          return;
        }
      }
    }

    const arrow = ARROWS[e.key];
    if (arrow && !e.altKey) {
      e.preventDefault();
      navigate(arrow[0], arrow[1], e.shiftKey, mod);
      return;
    }
    if (mod || e.altKey) {
      // Ctrl+Space selects the column (Shift+Space, below, the row).
      if (e.ctrlKey && e.key === " ") {
        e.preventDefault();
        setSelection({ anchor: { row: 0, col: selectionBounds.minCol }, focus: { row: rows - 1, col: selectionBounds.maxCol } });
      }
      return;
    }

    const from = e.shiftKey ? selection.focus : selection.anchor;
    const moveTo = (target: CellAddress) =>
      selectAndReveal(e.shiftKey ? { anchor: selection.anchor, focus: target } : singleCellRange(target));
    const pageRows = Math.max(1, Math.floor(((containerRef.current?.clientHeight ?? 0) - COL_HEADER_HEIGHT) / CELL_HEIGHT) - 1);

    switch (e.key) {
      case "Enter":
        e.preventDefault();
        step(e.shiftKey ? "up" : "down");
        return;
      case "Tab":
        e.preventDefault();
        step(e.shiftKey ? "left" : "right");
        return;
      case "Home":
        e.preventDefault();
        moveTo({ row: from.row, col: 0 });
        return;
      case "End":
        e.preventDefault();
        moveTo({ row: from.row, col: lastUsedCell((a) => a.row !== from.row || engine.isEmpty(a), rows, cols).col });
        return;
      case "PageDown":
        e.preventDefault();
        moveTo(clampCell(from.row + pageRows, from.col));
        return;
      case "PageUp":
        e.preventDefault();
        moveTo(clampCell(from.row - pageRows, from.col));
        return;
      case "F2":
        e.preventDefault();
        startEdit(activeCell, engine.raw(activeCell), "cell", "edit");
        return;
      case "Backspace":
      case "Delete":
        e.preventDefault();
        clearSelection();
        return;
      case "Escape":
        if (copied) {
          // Only stop propagation when there was actually a copy highlight
          // to clear — with nothing more specific to do, Escape should
          // still fall through to App.tsx's window-hide fallback.
          e.stopPropagation();
          setCopied(null);
        }
        return;
      case " ":
        if (e.shiftKey) {
          e.preventDefault();
          setSelection({ anchor: { row: selectionBounds.minRow, col: 0 }, focus: { row: selectionBounds.maxRow, col: cols - 1 } });
          return;
        }
        break;
    }

    // Any printable key starts typing over the active cell. (isComposing:
    // leave IME / dead-key composition to finish first.)
    if (e.key.length === 1 && !e.nativeEvent.isComposing) {
      e.preventDefault();
      startEdit(activeCell, e.key, "cell", "enter");
    }
  }

  // ------------------------------------------------------------------- render

  // Status-bar stats over the numbers in the selection (only shown for a
  // multi-cell selection — a single cell already shows its own value).
  const summary = useMemo(() => {
    const isMulti = selectionBounds.maxRow > selectionBounds.minRow || selectionBounds.maxCol > selectionBounds.minCol;
    if (!isMulti) return null;
    const numbers: number[] = [];
    for (let row = selectionBounds.minRow; row <= selectionBounds.maxRow; row++) {
      for (let col = selectionBounds.minCol; col <= selectionBounds.maxCol; col++) {
        const value = view.numbers[addressKey({ row, col })];
        if (value !== undefined) numbers.push(value);
      }
    }
    return summarize(numbers);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, selectionBounds.minRow, selectionBounds.maxRow, selectionBounds.minCol, selectionBounds.maxCol]);

  // Outlined for as long as a formula is being edited — including after the
  // drag that picked a reference ends — not just while dragging.
  const editValue = editing?.value;
  const formulaRefs = useMemo(
    () => (editValue !== undefined ? parseFormulaRefs(editValue, rows, cols) : []),
    [editValue],
  );
  const copiedOverlay = useMemo(() => (copied ? { bounds: copied.bounds, cut: copied.cut } : null), [copied]);

  const formulaBarValue = editing ? editing.value : engine.raw(activeCell);
  const activeFormat: CellFormat = formatting.getFormat(activeCell);
  const selectionLabel =
    dragMode === "select" || dragMode === "cols" || dragMode === "rows"
      ? `${selectionBounds.maxRow - selectionBounds.minRow + 1}R × ${selectionBounds.maxCol - selectionBounds.minCol + 1}C`
      : addressKey(activeCell);

  return (
    <div
      className="spreadsheet-tab"
      onCopy={(e) => handleCopy(e, false)}
      onCut={(e) => handleCopy(e, true)}
      onPaste={handlePaste}
    >
      <Toolbar
        activeFormat={activeFormat}
        onToggleBold={() => applyToggle("bold")}
        onToggleItalic={() => applyToggle("italic")}
        onSetFill={handleSetFill}
        onSetNumberFormat={handleSetNumberFormat}
        onChangeDecimals={handleChangeDecimals}
      />
      <FormulaBar
        inputRef={barInputRef}
        addressLabel={selectionLabel}
        value={formulaBarValue}
        isEditing={editing !== null}
        onChange={handleEditValueChange}
        onCaretChange={handleEditCaretChange}
        onFocus={handleFormulaBarFocus}
        onMouseDown={handleEditorMouseDown}
        onKeyDown={handleKeyDown}
      />
      <div
        ref={containerRef}
        className={dragMode === "fill" ? "grid-area is-filling" : "grid-area"}
        tabIndex={0}
        onKeyDown={handleKeyDown}
        onMouseDown={handleGridMouseDown}
        onDoubleClick={handleGridDoubleClick}
        onContextMenu={handleContextMenu}
      >
        <Grid
          rows={rows}
          cols={cols}
          gridRef={gridRef}
          geometry={geometry}
          cells={view.cells}
          formats={formatting.formats}
          activeCell={activeCell}
          selectionBounds={selectionBounds}
          fillPreviewBounds={dragMode === "fill" ? fillTarget : null}
          copied={copiedOverlay}
          formulaRefs={formulaRefs}
          isDragging={dragMode !== null}
          getColumnWidth={columnWidths.getWidth}
          onColumnResize={columnWidths.setWidth}
          onColumnAutoFit={handleColumnAutoFit}
          editing={editing}
          editingInputRef={cellInputRef}
          onFillHandleMouseDown={handleFillHandleMouseDown}
          onEditValueChange={handleEditValueChange}
          onEditCaretChange={handleEditCaretChange}
          onEditorMouseDown={handleEditorMouseDown}
        />
      </div>
      {/* Always present (an appearing/disappearing bar would resize the grid
          every time a selection grows past one cell). */}
      <div className="status-bar" aria-live="polite">
        {summary &&
          (
            [
              ["Sum", summary.sum],
              ["Average", summary.average],
              ["Count", summary.count],
              ["Min", summary.min],
              ["Max", summary.max],
            ] as const
          ).map(([label, value]) => (
            <button
              key={label}
              type="button"
              className="status-stat"
              title={`Click to copy ${label.toLowerCase()}`}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                void navigator.clipboard.writeText(String(value));
                showToast("Copied");
              }}
            >
              <span className="status-label">{label}</span> {formatPlainNumber(value)}
            </button>
          ))}
      </div>
      {editing && suggestions.length > 0 && suggestPosition && (
        <FunctionSuggestions
          names={suggestions}
          activeIndex={Math.min(suggestIndex, suggestions.length - 1)}
          position={suggestPosition}
          onPick={acceptSuggestion}
        />
      )}
    </div>
  );
}
