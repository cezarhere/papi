import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";
import { useToast } from "../../ToastContext";
import { AGGREGATE_KEYWORDS } from "./classifyLine";
import type { CalculatorLine } from "./types";
import { useHeldResult } from "./useHeldResult";

const COPIED_FLASH_MS = 700;

interface LineProps {
  line: CalculatorLine;
  isSelected: boolean;
  inputRef: (el: HTMLTextAreaElement | null) => void;
  onChange: (value: string) => void;
  onKeyDown: (e: KeyboardEvent<HTMLTextAreaElement>) => void;
  onMouseDown: (e: MouseEvent<HTMLTextAreaElement>) => void;
  onMouseEnter: () => void;
  // Numi-style column divider (Phase H) — a single shared element lives
  // in CalculatorTab.tsx, not one per row; this row only needs the
  // current position to size its own input.
  inputColumnPercent: number;
}

export default function Line({
  line,
  isSelected,
  inputRef,
  onChange,
  onKeyDown,
  onMouseDown,
  onMouseEnter,
  inputColumnPercent,
}: LineProps) {
  // Numi-style hold: while this line is mid-typing and doesn't currently
  // resolve to anything (evaluateLine.ts's kind:"text"/result:null), keep
  // showing the last real result for a beat instead of flashing it away —
  // see useHeldResult.ts. A fresh number or a definitive "Error" always
  // wins immediately; only the "nothing yet" state gets held.
  const trimmed = line.raw.trim();
  const displayed = useHeldResult(line.result, line.kind, trimmed === "");

  // Auto-growing textarea (replaces a single-line <input>, Phase I) —
  // text that doesn't fit the current divider-driven width wraps onto
  // additional visual lines instead of scrolling/hiding within a fixed-
  // height box. Soft-wrap only: Enter is always intercepted (onKeyDown,
  // CalculatorTab.tsx) before it can insert a real newline, so wrapping
  // never changes the stored value, only how it's laid out.
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  function resizeToFitContent() {
    const el = textareaRef.current;
    if (!el) return;
    // Reset before measuring — scrollHeight only shrinks correctly if
    // the element isn't still holding a taller explicit height from
    // before (e.g. after deleting a wrapped line back down to one).
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }

  // Recompute on content change (typing) — a width-only ResizeObserver
  // wouldn't catch "same width, more/fewer wrapped lines" on its own.
  useEffect(() => {
    resizeToFitContent();
  }, [line.raw, inputColumnPercent]);

  // Recompute on any actual width change this row wasn't told about
  // directly — the divider redistributes width via a shared percentage
  // (inputColumnPercent, already covered above), but the *window* being
  // resized changes every row's actual pixel width without that
  // percentage changing at all.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => resizeToFitContent());
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Numi-style copy feedback: a rounded pill in the result's own color,
  // text inverted to the background, for a beat after clicking it.
  const [justCopied, setJustCopied] = useState(false);
  const copiedTimeoutRef = useRef<number | null>(null);
  const showToast = useToast();

  useEffect(() => {
    return () => {
      if (copiedTimeoutRef.current !== null) window.clearTimeout(copiedTimeoutRef.current);
    };
  }, []);

  function handleResultClick() {
    if (!displayed.result) return;
    void navigator.clipboard.writeText(displayed.result);
    showToast("Copied");
    setJustCopied(true);
    if (copiedTimeoutRef.current !== null) window.clearTimeout(copiedTimeoutRef.current);
    copiedTimeoutRef.current = window.setTimeout(() => setJustCopied(false), COPIED_FLASH_MS);
  }

  const rowClassNames = ["calc-line"];
  if (isSelected) rowClassNames.push("calc-line-selected");

  const resultClassNames = ["calc-line-result"];
  if (displayed.kind === "error") resultClassNames.push("calc-line-result-error");
  // Name/keyword-driven results (a labeled value, an aggregate) get the
  // same accent blue as recognized input keywords — same "this was
  // parsed/named" signal DESIGN.md's --text-accent token already carries,
  // just applied to the computed side too. Plain computed values
  // (arithmetic/unit/currency/date/time) keep the default result color.
  if (displayed.kind === "variable" || displayed.kind === "aggregate") {
    resultClassNames.push("calc-line-result-accent");
  }
  if (justCopied) resultClassNames.push("calc-line-result-copied");

  const inputClassNames = ["calc-line-input"];
  // Keyword styling reflects recognition, not computation success — an
  // empty-block "average"/"min"/"max" still is that keyword, it just
  // has nothing to aggregate (kind ends up "error", not "aggregate").
  // "prev" isn't its own kind either (its result is a plain computed
  // value, same as arithmetic), so it's checked the same way.
  if (AGGREGATE_KEYWORDS.has(trimmed) || trimmed === "prev") {
    inputClassNames.push("calc-line-input-keyword");
  }

  return (
    <div className={rowClassNames.join(" ")} onMouseEnter={onMouseEnter}>
      <textarea
        ref={(el) => {
          textareaRef.current = el;
          inputRef(el);
        }}
        className={inputClassNames.join(" ")}
        style={{ flex: `0 0 ${inputColumnPercent}%` }}
        rows={1}
        spellCheck={false}
        value={line.raw}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        onMouseDown={onMouseDown}
      />
      <span className={resultClassNames.join(" ")} onClick={handleResultClick}>
        {/* Only the outer span's dir="rtl" (CSS) changes which side
            overflow spills off of, so clipping cuts the start, not the
            end — see CalculatorTab.css's .calc-line-result comment.
            unicode-bidi:bidi-override (.calc-line-result-value) forces
            this inner span to render strictly left-to-right with no
            bidi reordering at all; plain dir="ltr" alone still lets a
            few boundary characters leak across the clip edge onto the
            wrong (input) side when the value contains digits/punctuation
            next to the clip point. */}
        <span className="calc-line-result-value">{displayed.result ?? ""}</span>
      </span>
    </div>
  );
}
