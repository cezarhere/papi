import { useCallback, useState } from "react";
import { addressKey } from "./address";
import type { CellAddress, CellFormat } from "./types";

const EMPTY_FORMAT: CellFormat = {};

function isEmptyFormat(format: CellFormat): boolean {
  return !format.bold && !format.italic && !format.fill && !format.numberFormat;
}

// Before/after snapshot of the cells touched by one applyFormat call, keyed
// by address — what the undo history needs to replay the change either way.
export type FormatSnapshot = Record<string, CellFormat | undefined>;

export interface CellFormatting {
  // The raw store, keyed by "A1"-style address — for persistence (save).
  formats: Record<string, CellFormat>;
  getFormat(address: CellAddress): CellFormat;
  applyFormat(
    addresses: CellAddress[],
    updater: (current: CellFormat) => CellFormat,
  ): { before: FormatSnapshot; after: FormatSnapshot };
  restore(snapshot: FormatSnapshot): void;
  // Replaces the entire store outright — for loading a saved file. Not
  // undo-tracked; loading a document resets history.
  replaceAll(next: Record<string, CellFormat>): void;
}

// Owns cell formatting (bold/italic/fill), kept entirely separate from the
// HyperFormula instance per SPEC.md's architecture decisions.
export function useCellFormatting(): CellFormatting {
  const [formats, setFormats] = useState<Record<string, CellFormat>>({});

  const getFormat = useCallback(
    (address: CellAddress): CellFormat => formats[addressKey(address)] ?? EMPTY_FORMAT,
    [formats],
  );

  // Reads `formats` directly rather than via a setState updater — this is
  // only ever called from event handlers, so the render's `formats` is
  // already current, and it lets us return a snapshot without risking a
  // side-effecting updater running twice under StrictMode.
  const applyFormat = useCallback(
    (addresses: CellAddress[], updater: (current: CellFormat) => CellFormat) => {
      const before: FormatSnapshot = {};
      const after: FormatSnapshot = {};
      const next = { ...formats };
      for (const address of addresses) {
        const key = addressKey(address);
        before[key] = formats[key];
        const updated = updater(formats[key] ?? EMPTY_FORMAT);
        after[key] = updated;
        if (isEmptyFormat(updated)) {
          delete next[key];
        } else {
          next[key] = updated;
        }
      }
      setFormats(next);
      return { before, after };
    },
    [formats],
  );

  const restore = useCallback(
    (snapshot: FormatSnapshot) => {
      const next = { ...formats };
      for (const [key, value] of Object.entries(snapshot)) {
        if (value === undefined || isEmptyFormat(value)) {
          delete next[key];
        } else {
          next[key] = value;
        }
      }
      setFormats(next);
    },
    [formats],
  );

  const replaceAll = useCallback((next: Record<string, CellFormat>) => {
    setFormats(next);
  }, []);

  return { formats, getFormat, applyFormat, restore, replaceAll };
}
