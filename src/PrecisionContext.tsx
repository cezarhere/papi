import { createContext, useContext } from "react";

// Matches evaluateLine.ts's formatNumber's original hardcoded value —
// changing this default would change existing users' results with no
// action on their part, so it stays fixed even if the UI's own preset
// list changes later.
export const DEFAULT_PRECISION = 10;

export interface PrecisionContextValue {
  precision: number;
  setPrecision: (value: number) => void;
}

// App.tsx provides the real implementation (localStorage-backed state);
// this default just means nothing crashes if somehow rendered outside
// the provider.
export const PrecisionContext = createContext<PrecisionContextValue>({
  precision: DEFAULT_PRECISION,
  setPrecision: () => {},
});

export function usePrecision(): PrecisionContextValue {
  return useContext(PrecisionContext);
}
