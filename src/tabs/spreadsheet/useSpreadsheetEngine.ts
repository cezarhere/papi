import { useMemo, useState } from "react";
import { createSheetEngine, type CellRawValue, type SheetEngine } from "./engine";

export type { CellRawValue } from "./engine";

export interface SpreadsheetEngine extends SheetEngine {
  // Bumped after every write. HyperFormula's own mutations aren't visible
  // to React, so this is the stable primitive that memos and effects (the
  // display model, autosave) depend on.
  revision: number;
}

// Owns the engine instance (created once, from the autosaved cells, and
// kept stable across renders) and makes its writes visible to React.
export function useSpreadsheetEngine(initialCells: Record<string, CellRawValue>): SpreadsheetEngine {
  const [core] = useState(() => createSheetEngine(initialCells));
  const [revision, setRevision] = useState(0);

  const api = useMemo((): SheetEngine => {
    const bump = () => setRevision((n) => n + 1);
    const changed = (done: boolean) => {
      if (done) bump();
      return done;
    };
    return {
      ...core,
      setCell: (address, rawInput) => {
        core.setCell(address, rawInput);
        bump();
      },
      setMatrix: (topLeft, values) => {
        const written = core.setMatrix(topLeft, values);
        if (written) bump();
        return written;
      },
      clear: (bounds) => {
        core.clear(bounds);
        bump();
      },
      copyInto: (source, target, series) => {
        core.copyInto(source, target, series);
        bump();
      },
      move: (source, destination) => {
        const moved = core.move(source, destination);
        if (moved) bump();
        return moved;
      },
      sortRows: (bounds, order) => {
        core.sortRows(bounds, order);
        bump();
      },
      insertRows: (index, count) => changed(core.insertRows(index, count)),
      insertCols: (index, count) => changed(core.insertCols(index, count)),
      removeRows: (index, count) => changed(core.removeRows(index, count)),
      removeCols: (index, count) => changed(core.removeCols(index, count)),
      undo: () => {
        const done = core.undo();
        if (done) bump();
        return done;
      },
      redo: () => {
        const done = core.redo();
        if (done) bump();
        return done;
      },
    };
  }, [core]);

  return useMemo(() => ({ ...api, revision }), [api, revision]);
}
