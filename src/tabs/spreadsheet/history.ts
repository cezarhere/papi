import type { CellRange } from "./types";
import type { FormatSnapshot } from "./useCellFormatting";

// One undo-able user action. It can change content, formatting, or both at
// once (a paste or a fill carries formats along). Content carries no data:
// the formula engine keeps its own before/after, so `content: true` just
// means "this action is one step on the engine's undo stack" — which is why
// an entry must only ever be recorded when the engine really took a step.
export interface HistoryEntry {
  content: boolean;
  format?: { before: FormatSnapshot; after: FormatSnapshot };
  // Column widths, when the action moved columns (insert/delete column).
  widths?: { before: Record<string, number>; after: Record<string, number> };
  // Selection when the action happened; restored on undo and redo.
  selection: CellRange;
}

export interface History {
  entries: HistoryEntry[];
  // Number of entries currently applied; entries past it are redo-able.
  index: number;
}

export const EMPTY_HISTORY: History = { entries: [], index: 0 };

export function pushHistory(history: History, entry: HistoryEntry): History {
  return { entries: [...history.entries.slice(0, history.index), entry], index: history.index + 1 };
}

export function peekUndo(history: History): HistoryEntry | null {
  return history.index > 0 ? history.entries[history.index - 1] : null;
}

export function peekRedo(history: History): HistoryEntry | null {
  return history.index < history.entries.length ? history.entries[history.index] : null;
}

export function stepHistory(history: History, delta: 1 | -1): History {
  return { ...history, index: history.index + delta };
}
