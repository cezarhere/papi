import { describe, expect, it } from "vitest";
import { autoSumRange, currentRegion, hasHeaderRow, shiftFormats, shiftWidths, sortOrder } from "../structure";

describe("sortOrder", () => {
  it("numbers, then text, blanks always last — in both directions", () => {
    const keys = [3, "pear", null, 1, "Apple", 2];
    expect(sortOrder(keys, false).map((i) => keys[i])).toEqual([1, 2, 3, "Apple", "pear", null]);
    expect(sortOrder(keys, true).map((i) => keys[i])).toEqual(["pear", "Apple", 3, 2, 1, null]);
  });
  it("is stable, and compares digits inside text as numbers", () => {
    expect(sortOrder([1, 1, 1], false)).toEqual([0, 1, 2]);
    expect(sortOrder([1, 1, 1], true)).toEqual([0, 1, 2]);
    const keys = ["item 10", "item 2"];
    expect(sortOrder(keys, false).map((i) => keys[i])).toEqual(["item 2", "item 10"]);
  });
  it("spots a text header over numbers", () => {
    expect(hasHeaderRow(["Price", 3, 1])).toBe(true);
    expect(hasHeaderRow(["b", "a", "c"])).toBe(false);
    expect(hasHeaderRow([5, 3, 1])).toBe(false);
    expect(hasHeaderRow(["Price"])).toBe(false);
  });
});

describe("regions", () => {
  const filled = new Set(["1,1", "1,2", "2,1", "2,2", "3,2", "6,6"]);
  const isEmpty = (a: { row: number; col: number }) => !filled.has(`${a.row},${a.col}`);
  it("grows to the block of data around a cell", () => {
    expect(currentRegion(isEmpty, { row: 2, col: 1 }, 10, 10)).toEqual({ minRow: 1, maxRow: 3, minCol: 1, maxCol: 2 });
    expect(currentRegion(isEmpty, { row: 8, col: 8 }, 10, 10)).toEqual({ minRow: 8, maxRow: 8, minCol: 8, maxCol: 8 });
  });
  it("AutoSum takes the numbers above, else to the left", () => {
    const isNumber = (a: { row: number; col: number }) => !isEmpty(a);
    expect(autoSumRange(isNumber, { row: 4, col: 2 })).toEqual({ minRow: 1, maxRow: 3, minCol: 2, maxCol: 2 });
    expect(autoSumRange(isNumber, { row: 1, col: 3 })).toEqual({ minRow: 1, maxRow: 1, minCol: 1, maxCol: 2 });
    expect(autoSumRange(isNumber, { row: 9, col: 9 })).toBeNull();
  });
});

describe("formats and widths follow inserted/deleted lines", () => {
  const formats = { A1: { bold: true }, A2: { italic: true }, B3: { fill: "#fff" } };
  it("insert shifts, delete drops and closes up", () => {
    expect(shiftFormats(formats, "row", 1, 2, 50, 26)).toEqual({ A1: { bold: true }, A4: { italic: true }, B5: { fill: "#fff" } });
    expect(shiftFormats(formats, "row", 1, -1, 50, 26)).toEqual({ A1: { bold: true }, B2: { fill: "#fff" } });
    expect(shiftFormats(formats, "col", 0, 1, 50, 26)).toEqual({ B1: { bold: true }, B2: { italic: true }, C3: { fill: "#fff" } });
    expect(shiftFormats({ A50: { bold: true } }, "row", 0, 1, 50, 26)).toEqual({});
  });
  it("column widths move with their columns", () => {
    expect(shiftWidths({ "0": 100, "2": 140 }, 1, 1, 26)).toEqual({ "0": 100, "3": 140 });
    expect(shiftWidths({ "0": 100, "1": 90, "2": 140 }, 1, -1, 26)).toEqual({ "0": 100, "1": 140 });
    expect(shiftWidths({ "25": 100 }, 0, 1, 26)).toEqual({});
  });
});
