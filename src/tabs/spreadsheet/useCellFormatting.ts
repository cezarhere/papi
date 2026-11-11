import { useCallback, useState } from "react";
import { addressKey } from "./address";
import type { CellAddress, CellFormat } from "./types";

const EMPTY_FORMAT: CellFormat = {};

function isEmptyFormat(format: CellFormat): boolean {
  return !format.bold && !format.italic && !format.fill && !format.numberFormat;
}

// Before/after snapshot of the cells touched by one change, keyed by
// address — what the undo history needs to replay the change either way.
export type FormatSnapshot = Record<string, CellFormat | undefined>;

export interface FormatChange {
  before: FormatSnapshot;
  after: FormatSnapshot;
}

export interface CellFormatting {
  // The raw store, keyed by "A1"-style address — for persistence (save).
  formats: Record<string, CellFormat>;
  getFormat(address: CellAddress): CellFormat;
  // Runs `updater` over each address (toolbar actions).
  applyFormat(
    addresses: CellAddress[],
    updater: (current: CellFormat, address: CellAddress) => CellFormat,
  ): FormatChange;
  // Sets (or, with undefined, clears) whole formats by key — what paste,
  // fill and cut use to carry formatting along with content.
  setMany(next: FormatSnapshot): FormatChange;
  restore(snapshot: FormatSnapshot): void;
}

// Owns cell formatting (bold/italic/fill/number format), kept entirely
// separate from the formula engine per SPEC.md's architecture decisions.
export function useCellFormatting(initial: Record<string, CellFormat>): CellFormatting {
  const [formats, setFormats] = useState<Record<string, CellFormat>>(initial);

  const getFormat = useCallback(
    (address: CellAddress): CellFormat => formats[addressKey(address)] ?? EMPTY_FORMAT,
    [formats],
  );

  // Reads `formats` directly rather than via a setState updater — this is
  // only ever called from event handlers, so the render's `formats` is
  // already current, and it lets us return a snapshot without risking a
  // side-effecting updater running twice under StrictMode.
  const setMany = useCallback(
    (changes: FormatSnapshot): FormatChange => {
      const before: FormatSnapshot = {};
      const after: FormatSnapshot = {};
      const next = { ...formats };
      for (const [key, value] of Object.entries(changes)) {
        before[key] = formats[key];
        if (value === undefined || isEmptyFormat(value)) {
          after[key] = undefined;
          delete next[key];
        } else {
          after[key] = value;
          next[key] = value;
        }
      }
      setFormats(next);
      return { before, after };
    },
    [formats],
  );

  const applyFormat = useCallback(
    (addresses: CellAddress[], updater: (current: CellFormat, address: CellAddress) => CellFormat): FormatChange => {
      const changes: FormatSnapshot = {};
      for (const address of addresses) {
        const key = addressKey(address);
        changes[key] = updater(formats[key] ?? EMPTY_FORMAT, address);
      }
      return setMany(changes);
    },
    [formats, setMany],
  );

  const restore = useCallback(
    (snapshot: FormatSnapshot) => {
      setMany(snapshot);
    },
    [setMany],
  );

  return { formats, getFormat, applyFormat, setMany, restore };
}
