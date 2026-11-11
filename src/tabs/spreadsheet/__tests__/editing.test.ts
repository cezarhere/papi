import { describe, expect, it } from "vitest";
import { encodeTsv, parseTsv } from "../clipboard";
import {
  closeParens,
  cycleAbsolute,
  functionTokenAt,
  normalizeCellInput,
  refInsertionSpan,
  suggestFunctions,
} from "../formulaEdit";
import { EMPTY_HISTORY, peekRedo, peekUndo, pushHistory, stepHistory } from "../history";
import { jumpTarget, lastUsedCell } from "../navigation";
import { singleCellRange } from "../range";

describe("committing input", () => {
  it("closes missing parentheses, but not inside strings", () => {
    expect(closeParens("=SUM(A1:A3")).toBe("=SUM(A1:A3)");
    expect(closeParens("=IF(A1>0,SUM(B1:B2")).toBe("=IF(A1>0,SUM(B1:B2))");
    expect(closeParens('="("')).toBe('="("');
    expect(closeParens("=(1+2)")).toBe("=(1+2)");
  });
  it("strips thousands separators from numbers only", () => {
    expect(normalizeCellInput("1,234.50")).toBe("1234.50");
    expect(normalizeCellInput("$1,234,567")).toBe("$1234567");
    expect(normalizeCellInput("Smith, John")).toBe("Smith, John");
    expect(normalizeCellInput("1,2,3")).toBe("1,2,3");
    expect(normalizeCellInput("=SUM(1,234")).toBe("=SUM(1,234)");
  });
});

describe("picking a cell into a formula", () => {
  const span = (value: string, caret = value.length) => refInsertionSpan(value, caret, caret);
  it("inserts after an operator, bracket or comma", () => {
    expect(span("=")).toEqual({ start: 1, end: 1 });
    expect(span("=A1+")).toEqual({ start: 4, end: 4 });
    expect(span("=SUM(")).toEqual({ start: 5, end: 5 });
    expect(span("=SUM()", 5)).toEqual({ start: 5, end: 5 });
    expect(span("=IF(A1, ")).toEqual({ start: 8, end: 8 });
  });
  it("replaces the reference the caret is on, instead of appending", () => {
    expect(span("=A1")).toEqual({ start: 1, end: 3 });
    expect(span("=SUM(B2:C4")).toEqual({ start: 5, end: 10 });
    expect(span("=A1+B22", 5)).toEqual({ start: 4, end: 7 });
  });
  it("has nowhere to put one after a number, a closed bracket or in plain text", () => {
    expect(span("=12")).toBeNull();
    expect(span("=SUM(A1)")).toBeNull();
    expect(span("hello")).toBeNull();
    expect(span("=LOG10")).toBeNull();
  });
  it("replaces selected text", () => {
    expect(refInsertionSpan("=A1+B2", 4, 6)).toEqual({ start: 4, end: 6 });
  });
});

describe("function autocomplete", () => {
  const names = ["ABS", "SUBSTITUTE", "SUM", "SUMIF", "SUMPRODUCT"];
  it("finds the word being typed", () => {
    expect(functionTokenAt("=su", 3)).toEqual({ start: 1, token: "su" });
    expect(functionTokenAt("=A1+SU", 6)).toEqual({ start: 4, token: "SU" });
    expect(functionTokenAt("=SUM(", 5)).toBeNull();
    expect(functionTokenAt('="su', 4)).toBeNull();
    expect(functionTokenAt("su", 2)).toBeNull();
    expect(functionTokenAt("=A1:B", 5)).toBeNull();
  });
  it("puts everyday functions first", () => {
    expect(suggestFunctions("su", names)).toEqual(["SUM", "SUMIF", "SUBSTITUTE", "SUMPRODUCT"]);
    expect(suggestFunctions("zz", names)).toEqual([]);
  });
});

describe("F4", () => {
  it("cycles relative → absolute → row → column", () => {
    let state = { value: "=A1+B2", caret: 3 };
    const seen: string[] = [];
    for (let i = 0; i < 4; i++) {
      state = cycleAbsolute(state.value, state.caret)!;
      seen.push(state.value);
    }
    expect(seen).toEqual(["=$A$1+B2", "=A$1+B2", "=$A1+B2", "=A1+B2"]);
    expect(cycleAbsolute("=SUM(1,2)", 5)).toBeNull();
  });
});

describe("clipboard text", () => {
  it("round-trips a block, including cells with tabs, quotes and newlines", () => {
    const rows = [["a", "1,5"], ['say "hi"', "two\nlines"], ["", "tab\there"]];
    expect(parseTsv(encodeTsv(rows))).toEqual(rows);
  });
  it("reads what other spreadsheets write", () => {
    expect(parseTsv("1\t2\r\n3\t4\r\n")).toEqual([["1", "2"], ["3", "4"]]);
    expect(parseTsv("just text")).toEqual([["just text"]]);
    expect(parseTsv("")).toEqual([]);
    expect(parseTsv('5" pipe\tx')).toEqual([['5" pipe', "x"]]);
  });
});

describe("Cmd+Arrow", () => {
  // Column A: rows 0-2 filled, 3-4 empty, 5 filled.
  const filled = new Set(["0,0", "1,0", "2,0", "5,0"]);
  const isEmpty = (a: { row: number; col: number }) => !filled.has(`${a.row},${a.col}`);
  const down = (row: number) => jumpTarget(isEmpty, { row, col: 0 }, 1, 0, 10, 3).row;
  it("goes to the end of a run, then the next filled cell, then the edge", () => {
    expect(down(0)).toBe(2);
    expect(down(2)).toBe(5);
    expect(down(3)).toBe(5);
    expect(down(5)).toBe(9);
    expect(down(9)).toBe(9);
    expect(jumpTarget(isEmpty, { row: 5, col: 0 }, -1, 0, 10, 3).row).toBe(2);
    expect(jumpTarget(isEmpty, { row: 0, col: 0 }, 0, 1, 10, 3).col).toBe(2);
  });
  it("finds the last used cell", () => {
    expect(lastUsedCell(isEmpty, 10, 3)).toEqual({ row: 5, col: 0 });
    expect(lastUsedCell(() => true, 10, 3)).toEqual({ row: 0, col: 0 });
  });
});

describe("undo history", () => {
  const selection = singleCellRange({ row: 0, col: 0 });
  it("walks back and forward in order, and a new action drops the redo tail", () => {
    let h = EMPTY_HISTORY;
    h = pushHistory(h, { content: true, selection });
    h = pushHistory(h, { content: false, format: { before: {}, after: { A1: { bold: true } } }, selection });
    expect(peekUndo(h)?.content).toBe(false);
    h = stepHistory(h, -1);
    expect(peekUndo(h)?.content).toBe(true);
    expect(peekRedo(h)?.format).toBeDefined();
    h = pushHistory(h, { content: true, selection });
    expect(peekRedo(h)).toBeNull();
    expect(h.entries).toHaveLength(2);
    expect(peekUndo(EMPTY_HISTORY)).toBeNull();
  });
});
