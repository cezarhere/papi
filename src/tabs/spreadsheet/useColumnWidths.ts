import { useCallback, useState } from "react";
import { CELL_WIDTH } from "./constants";

export const MIN_COLUMN_WIDTH = 40;
export const MAX_COLUMN_WIDTH = 400;

export interface ColumnWidths {
  // Raw store keyed by column index as a string — for persistence.
  widths: Record<string, number>;
  getWidth(col: number): number;
  setWidth(col: number, width: number): void;
  replaceAll(next: Record<string, number>): void;
}

export function clampWidth(width: number): number {
  return Math.min(MAX_COLUMN_WIDTH, Math.max(MIN_COLUMN_WIDTH, Math.round(width)));
}

// Per-column widths; columns not in the store use the default CELL_WIDTH.
// Kept outside the formula engine and the format store (neither concept
// applies) and not undo-tracked, like most spreadsheet apps.
export function useColumnWidths(): ColumnWidths {
  const [widths, setWidths] = useState<Record<string, number>>({});

  const getWidth = useCallback((col: number) => widths[String(col)] ?? CELL_WIDTH, [widths]);

  const setWidth = useCallback((col: number, width: number) => {
    const clamped = clampWidth(width);
    setWidths((prev) => {
      const next = { ...prev };
      if (clamped === CELL_WIDTH) delete next[String(col)];
      else next[String(col)] = clamped;
      return next;
    });
  }, []);

  const replaceAll = useCallback((next: Record<string, number>) => {
    const cleaned: Record<string, number> = {};
    for (const [key, value] of Object.entries(next)) cleaned[key] = clampWidth(value);
    setWidths(cleaned);
  }, []);

  return { widths, getWidth, setWidth, replaceAll };
}
