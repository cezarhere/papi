import { useEffect, useRef, useState } from "react";
import type { LineKind } from "./types";

interface DisplayedResult {
  result: string | null;
  kind: LineKind;
}

const HOLD_DELAY_MS = 400;

// Numi-style "don't flash blank/error while still typing": a fresh
// evaluation of `null` (nothing recognized yet, e.g. "1 +" mid-expression)
// doesn't clear the display immediately — the previous result stays on
// screen for HOLD_DELAY_MS in case the next keystroke completes it. Any
// non-null result (a fresh number, or a definitive "Error" — see
// evaluateLine.ts's kind:"error" cases, all reached only once a shape is
// grammatically complete) commits immediately, no delay. This is purely a
// display smoothing effect — it never touches the actual computed
// environment (blockValues/names/prev), which still treats an in-progress
// line as having no value.
// `lineIsEmpty` skips the hold entirely — an emptied line (selected-all
// and deleted, say) should blank its result immediately, not linger on
// whatever it used to show. The hold is specifically for "still typing
// towards something," not "there used to be a value here."
export function useHeldResult(result: string | null, kind: LineKind, lineIsEmpty: boolean): DisplayedResult {
  const [displayed, setDisplayed] = useState<DisplayedResult>({ result, kind });
  const timeoutRef = useRef<number | null>(null);

  useEffect(() => {
    if (result !== null || lineIsEmpty) {
      if (timeoutRef.current !== null) {
        window.clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
      setDisplayed({ result, kind });
      return;
    }

    timeoutRef.current = window.setTimeout(() => {
      setDisplayed({ result: null, kind });
      timeoutRef.current = null;
    }, HOLD_DELAY_MS);

    return () => {
      if (timeoutRef.current !== null) window.clearTimeout(timeoutRef.current);
    };
  }, [result, kind, lineIsEmpty]);

  return displayed;
}
