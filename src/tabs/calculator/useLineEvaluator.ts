import { useMemo } from "react";
import { evaluateLines } from "./evaluateLine";
import type { CalculatorLine } from "./types";

export function useLineEvaluator(lines: CalculatorLine[], precision: number): CalculatorLine[] {
  return useMemo(() => evaluateLines(lines, precision), [lines, precision]);
}
