import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
} from "react";
import Line from "./calculator/Line";
import "./calculator/CalculatorTab.css";
import { loadCalculatorState, saveCalculatorState } from "./calculator/persistence";
import { useLineEvaluator } from "./calculator/useLineEvaluator";
import type { CalculatorLine } from "./calculator/types";
import { usePrecision } from "../PrecisionContext";

let nextLineId = 0;
function createLine(raw = ""): CalculatorLine {
  return { id: `line-${nextLineId++}`, raw, result: null, kind: "text" };
}

const AUTOSAVE_DEBOUNCE_MS = 500;

// Numi-style column divider (Phase H). Percentage of the row's width the
// input column gets; the result column takes whatever's left. Clamped so
// dragging can't collapse either side down to nothing — "you can only
// play a bit with it," not a full 0-100% range.
const DIVIDER_STORAGE_KEY = "calculator-divider-position";
const DEFAULT_DIVIDER_PERCENT = 62;
const MIN_DIVIDER_PERCENT = 35;
const MAX_DIVIDER_PERCENT = 75;

// inputColumnPercent is a percentage of each row's own *content* width
// (CalculatorTab.css's .calc-line-input flex-basis resolves against
// .calc-line's content box) — not of .calculator-tab's full width. The
// two differ by .calculator-tab's own horizontal padding (16px 24px)
// plus .calc-line's (5px 4px), so the drag handler below has to
// subtract the same fixed inset the rows do when turning a cursor X
// position into a percentage, or the stored value doesn't actually
// match where the columns split.
const TAB_PADDING_X = 24;
const LINE_PADDING_X = 4;
const TRACK_INSET = TAB_PADDING_X + LINE_PADDING_X;
// The divider's own CSS `left` (below) is positioned relative to
// .calc-lines, not .calculator-tab — .calc-lines already sits inside
// .calculator-tab's padding, so only .calc-line's own padding is left
// to account for there.
const DIVIDER_TRACK_INSET = LINE_PADDING_X;

function loadStoredDividerPercent(): number {
  const saved = localStorage.getItem(DIVIDER_STORAGE_KEY);
  const parsed = saved === null ? NaN : Number(saved);
  return Number.isFinite(parsed) ? parsed : DEFAULT_DIVIDER_PERCENT;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export default function CalculatorTab() {
  const [lines, setLines] = useState<CalculatorLine[]>(() => {
    const saved = loadCalculatorState();
    return saved && saved.length > 0 ? saved.map((raw) => createLine(raw)) : [createLine()];
  });
  const [focusRequestId, setFocusRequestId] = useState<string | null>(null);
  // Overrides the focus effect's default "caret at the end" placement —
  // set alongside focusRequestId only when landing mid-text matters (the
  // Enter-splits-a-line case below); every other focus request wants the
  // default (end-of-value) and leaves this null.
  const [pendingCaretPosition, setPendingCaretPosition] = useState<number | null>(null);
  const [focusIndex, setFocusIndex] = useState(0);
  const [selectionAnchorIndex, setSelectionAnchorIndex] = useState<
    number | null
  >(null);
  // Index a plain (non-Shift) mousedown started on, while the button is
  // still held — null otherwise. Tracked separately from
  // selectionAnchorIndex so a click that never moves stays a normal
  // click-to-place-the-caret; selectionAnchorIndex only gets set once the
  // drag actually crosses into a different line (see handleMouseEnter).
  const [dragStartIndex, setDragStartIndex] = useState<number | null>(null);
  const inputRefs = useRef<Record<string, HTMLTextAreaElement | null>>({});
  const containerRef = useRef<HTMLDivElement>(null);

  // Numi-style column divider (Phase H) — shared across every line, not
  // per-row, so dragging one repositions the whole column boundary at
  // once. isDraggingDivider is separate from the value itself so every
  // row's divider segment can stay highlighted for the whole drag, not
  // just whichever one the cursor happens to be over.
  const [inputColumnPercent, setInputColumnPercent] = useState<number>(loadStoredDividerPercent);
  const [isDraggingDivider, setIsDraggingDivider] = useState(false);

  const { precision } = usePrecision();
  const evaluatedLines = useLineEvaluator(lines, precision);

  const selectedRange =
    selectionAnchorIndex === null
      ? null
      : ([
          Math.min(selectionAnchorIndex, focusIndex),
          Math.max(selectionAnchorIndex, focusIndex),
        ] as const);

  // Focus a line's input once it exists in the DOM, after a line is
  // inserted, removed, or navigated to. Cursor goes to the end, so e.g.
  // replacing a selection with a typed character continues naturally
  // from right after it, rather than landing before it.
  useEffect(() => {
    if (focusRequestId === null) return;
    const input = inputRefs.current[focusRequestId];
    if (input) {
      input.focus();
      const caret = pendingCaretPosition ?? input.value.length;
      input.setSelectionRange(caret, caret);
    }
    setFocusRequestId(null);
    setPendingCaretPosition(null);
  }, [focusRequestId, pendingCaretPosition]);

  // Focus the first line on mount, and again every time the window is
  // actually shown (electron/main/index.ts's "window:shown" — cold
  // launch and every tray/global-shortcut reshow). The tray/shortcut
  // toggle hides rather than unmounting this component, so a mount-only
  // version of this effect never re-ran for that case, and focus
  // silently landed on whatever the browser's default is (the first
  // tabbable element — the Calculator tab button), showing up as a
  // stray focus ring around the tab instead of a blinking caret in the
  // first line. Confirmed (by testing the actual packaged app) that
  // neither document.visibilitychange nor window's own "focus" DOM
  // event reliably fire for Electron's hide()/show() — the explicit IPC
  // push is what's actually reliable here. onWindowShown is undefined
  // in the plain-browser dev workflow (no window to hide/show there in
  // the first place); the mount-time call below still covers that case.
  // Skipped if focus is already somewhere inside this tab's own inputs
  // — e.g. mid-edit when the window merely toggles OS focus without
  // ever having been hidden.
  useEffect(() => {
    function focusFirstLineIfNeeded() {
      const active = document.activeElement;
      const alreadyFocusedHere =
        active instanceof HTMLTextAreaElement &&
        Object.values(inputRefs.current).includes(active);
      if (alreadyFocusedHere) return;
      const container = containerRef.current;
      container?.querySelector<HTMLTextAreaElement>(".calc-line-input")?.focus();
    }
    focusFirstLineIfNeeded();
    return window.electronAPI?.onWindowShown(focusFirstLineIfNeeded);
  }, []);

  // Ends a drag-select wherever the mouse button comes up, even outside
  // any line — same reasoning as the spreadsheet grid's equivalent effect.
  useEffect(() => {
    if (dragStartIndex === null) return;
    function handleMouseUp() {
      setDragStartIndex(null);
    }
    window.addEventListener("mouseup", handleMouseUp);
    return () => window.removeEventListener("mouseup", handleMouseUp);
  }, [dragStartIndex]);

  // Divider drag: position is computed from cursor X relative to the
  // whole tab's own width, not any single row, so it stays correct
  // regardless of which row's divider segment the drag started on.
  // Persists on every move rather than only at drag-end — simpler than
  // tracking the final value separately, and a few extra localStorage
  // writes during a short drag cost nothing meaningful.
  useEffect(() => {
    if (!isDraggingDivider) return;
    let latestPercent: number | null = null;
    function handleMouseMove(e: globalThis.MouseEvent) {
      const container = containerRef.current;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      const trackWidth = rect.width - TRACK_INSET * 2;
      const percent = ((e.clientX - rect.left - TRACK_INSET) / trackWidth) * 100;
      const clamped = clamp(percent, MIN_DIVIDER_PERCENT, MAX_DIVIDER_PERCENT);
      latestPercent = clamped;
      setInputColumnPercent(clamped);
    }
    function handleMouseUp() {
      setIsDraggingDivider(false);
      // Persist once per drag, not on every mousemove (sync I/O in a hot path).
      if (latestPercent !== null) localStorage.setItem(DIVIDER_STORAGE_KEY, String(latestPercent));
    }
    document.body.style.cursor = "col-resize";
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      document.body.style.cursor = "";
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isDraggingDivider]);

  // Autosaves to localStorage (CALC_SPEC.md "Autosave"), debounced so a
  // burst of keystrokes doesn't write on every single one. Lines are
  // restored synchronously in the initial state above, so there's no
  // empty-then-loaded transition to guard against here. A pending save is
  // also flushed immediately when the window hides, the app quits, or the
  // page unloads — otherwise edits made in the last debounce interval
  // would be lost.
  const linesRef = useRef(lines);
  linesRef.current = lines;
  const savePendingRef = useRef(false);
  const flushSave = useCallback(() => {
    if (!savePendingRef.current) return;
    savePendingRef.current = false;
    saveCalculatorState(linesRef.current.map((line) => line.raw));
  }, []);

  useEffect(() => {
    savePendingRef.current = true;
    const timeoutId = window.setTimeout(flushSave, AUTOSAVE_DEBOUNCE_MS);
    return () => window.clearTimeout(timeoutId);
  }, [lines, flushSave]);

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

  function handleChange(id: string, value: string) {
    setSelectionAnchorIndex(null);
    // The textarea only has Enter intercepted, so a paste can still carry
    // real newlines. A calculator line is one line: split a multi-line
    // paste into separate lines instead of storing embedded "\n"s.
    if (/[\r\n]/.test(value)) {
      const [first, ...rest] = value.split(/\r\n|\r|\n/);
      const extra = rest.map((raw) => createLine(raw));
      setLines((prev) => {
        const index = prev.findIndex((line) => line.id === id);
        if (index === -1) return prev;
        const next = [...prev];
        next[index] = { ...next[index], raw: first };
        next.splice(index + 1, 0, ...extra);
        return next;
      });
      const last = extra[extra.length - 1];
      if (last) {
        setFocusRequestId(last.id);
        setFocusIndex((i) => i + extra.length);
      }
      return;
    }
    setLines((prev) =>
      prev.map((line) => (line.id === id ? { ...line, raw: value } : line)),
    );
  }

  // Deletes every line in an (inclusive) multi-line selection, regardless
  // of whether it was made with the keyboard (Shift+arrows, Cmd/Ctrl+A) or
  // the mouse (Shift+click) — both just populate the same selection range.
  function deleteRange(start: number, end: number) {
    setSelectionAnchorIndex(null);

    if (start === 0 && end === lines.length - 1) {
      const fresh = createLine();
      setLines([fresh]);
      setFocusIndex(0);
      setFocusRequestId(fresh.id);
      return;
    }

    const targetIndex = start > 0 ? start - 1 : 0;
    const targetId = lines[start - 1]?.id ?? lines[end + 1]?.id;
    setLines((prev) => [...prev.slice(0, start), ...prev.slice(end + 1)]);
    setFocusIndex(targetIndex);
    if (targetId) setFocusRequestId(targetId);
  }

  // Typing over a multi-line selection collapses it to one line holding
  // just the typed character — same "selection replaced by keystroke"
  // convention as a normal text field, extended to the line list.
  function replaceRange(start: number, end: number, text: string) {
    setSelectionAnchorIndex(null);
    const replacement = createLine(text);
    setLines((prev) => [
      ...prev.slice(0, start),
      replacement,
      ...prev.slice(end + 1),
    ]);
    setFocusIndex(start);
    setFocusRequestId(replacement.id);
  }

  function handleMouseDown(index: number, e: MouseEvent<HTMLTextAreaElement>) {
    if (e.shiftKey) {
      e.preventDefault();
      setSelectionAnchorIndex((prev) => prev ?? focusIndex);
      setFocusIndex(index);
      setFocusRequestId(lines[index].id);
    } else {
      setSelectionAnchorIndex(null);
      setFocusIndex(index);
      setDragStartIndex(index);
    }
  }

  // Only fires while a plain mousedown is still held (see dragStartIndex)
  // — and only actually starts a multi-line selection once the drag has
  // crossed into a *different* line, so a click that never moves stays a
  // normal click-to-place-the-caret inside that line's input.
  function handleMouseEnter(index: number) {
    if (dragStartIndex === null || dragStartIndex === index) return;
    setSelectionAnchorIndex((prev) => prev ?? dragStartIndex);
    setFocusIndex(index);
  }

  function handleKeyDown(
    id: string,
    index: number,
    e: KeyboardEvent<HTMLTextAreaElement>,
  ) {
    if (
      (e.key === "Backspace" || e.key === "Delete") &&
      selectedRange !== null
    ) {
      e.preventDefault();
      deleteRange(selectedRange[0], selectedRange[1]);
      return;
    }

    if (
      selectedRange !== null &&
      e.key.length === 1 &&
      !e.metaKey &&
      !e.ctrlKey &&
      !e.altKey
    ) {
      e.preventDefault();
      replaceRange(selectedRange[0], selectedRange[1], e.key);
      return;
    }

    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "a") {
      e.preventDefault();
      setSelectionAnchorIndex(0);
      setFocusIndex(lines.length - 1);
      setFocusRequestId(lines[lines.length - 1].id);
      return;
    }

    // Moving the caret without changing anything (unlike typing/Backspace/
    // Delete above, which replace or delete the selection) should just
    // drop the multi-line highlight and let the browser move the caret
    // normally — a selection that lingers after the cursor's already
    // moved elsewhere reads as stuck/stale.
    if (
      selectedRange !== null &&
      (e.key === "ArrowLeft" ||
        e.key === "ArrowRight" ||
        e.key === "Home" ||
        e.key === "End")
    ) {
      setSelectionAnchorIndex(null);
      return;
    }

    if (e.key === "Enter") {
      e.preventDefault();
      setSelectionAnchorIndex(null);
      // Splits at the caret, like a normal text editor — text before it
      // stays on this line, text after it moves down to the new one
      // (empty either side if the caret's at an end, same as before).
      const caret = e.currentTarget.selectionStart ?? lines[index].raw.length;
      const before = lines[index].raw.slice(0, caret);
      const after = lines[index].raw.slice(caret);
      const newLine = createLine(after);
      setLines((prev) => {
        const next = [...prev];
        next[index] = { ...next[index], raw: before };
        next.splice(index + 1, 0, newLine);
        return next;
      });
      setFocusIndex(index + 1);
      setFocusRequestId(newLine.id);
      setPendingCaretPosition(0);
      return;
    }

    if (e.key === "Backspace") {
      if (lines[index].raw === "" && lines.length > 1) {
        e.preventDefault();
        setSelectionAnchorIndex(null);
        const targetIndex = index > 0 ? index - 1 : 0;
        const targetId = lines[index - 1]?.id ?? lines[index + 1]?.id;
        setLines((prev) => prev.filter((line) => line.id !== id));
        setFocusIndex(targetIndex);
        if (targetId) setFocusRequestId(targetId);
      }
      return;
    }

    if (e.key === "ArrowUp") {
      e.preventDefault();
      const target = lines[index - 1];
      if (!target) return;
      if (e.shiftKey) {
        setSelectionAnchorIndex((prev) => prev ?? index);
      } else {
        setSelectionAnchorIndex(null);
      }
      setFocusIndex(index - 1);
      setFocusRequestId(target.id);
      return;
    }

    if (e.key === "ArrowDown") {
      e.preventDefault();
      const target = lines[index + 1];
      if (!target) return;
      if (e.shiftKey) {
        setSelectionAnchorIndex((prev) => prev ?? index);
      } else {
        setSelectionAnchorIndex(null);
      }
      setFocusIndex(index + 1);
      setFocusRequestId(target.id);
      return;
    }
  }

  return (
    <div className="calculator-tab" ref={containerRef}>
      {/* .calc-lines is a plain block wrapper (natural, content-driven
          height) around the divider + rows, nested inside the actual
          scrolling element (.calculator-tab, which has a *fixed*
          client height). The divider is positioned relative to
          .calc-lines specifically so top:0/bottom:0 stretches it to
          the full scrollable content height — sized against
          .calculator-tab directly, it would only cover that fixed
          client height and vanish partway down once the list scrolls
          past it. */}
      <div className="calc-lines">
        {/* Single continuous divider (Phase H, Numi-style) — one element
            spanning the whole list, not one per row, so it reads as a
            single unbroken line rather than a stack of short per-row
            segments. `left` mirrors the same TRACK_INSET-adjusted formula
            the drag handler uses to compute inputColumnPercent (and that
            each row's input/result columns resolve their own widths
            against) — using a plain `${inputColumnPercent}%` here would
            place the line a few pixels off from where the columns
            actually split, which read as result values leaking past it. */}
        <div
          className={
            isDraggingDivider ? "calc-divider calc-divider-active" : "calc-divider"
          }
          style={{
            left: `calc(${DIVIDER_TRACK_INSET}px + (100% - ${DIVIDER_TRACK_INSET * 2}px) * ${inputColumnPercent} / 100)`,
          }}
          onMouseDown={(e) => {
            e.preventDefault();
            setIsDraggingDivider(true);
          }}
        />
        {evaluatedLines.map((line, index) => (
          <Line
            key={line.id}
            line={line}
            isSelected={
              selectedRange !== null &&
              index >= selectedRange[0] &&
              index <= selectedRange[1]
            }
            inputRef={(el) => {
              inputRefs.current[line.id] = el;
            }}
            onChange={(value) => handleChange(line.id, value)}
            onKeyDown={(e) => handleKeyDown(line.id, index, e)}
            onMouseDown={(e) => handleMouseDown(index, e)}
            onMouseEnter={() => handleMouseEnter(index)}
            inputColumnPercent={inputColumnPercent}
          />
        ))}
      </div>
    </div>
  );
}
