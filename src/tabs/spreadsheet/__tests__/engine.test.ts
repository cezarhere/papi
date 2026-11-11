import { describe, expect, it } from "vitest";
import { createSheetEngine } from "../engine";
import { parseAddressKey } from "../address";
import { formatAutoValue } from "../numberFormat";

const at = (key: string) => parseAddressKey(key)!;
const box = (from: string, to: string) => {
  const a = at(from);
  const b = at(to);
  return { minRow: a.row, maxRow: b.row, minCol: a.col, maxCol: b.col };
};
const make = (cells: Record<string, string> = {}) => createSheetEngine(cells, "MDY");

describe("values and how they are recognised", () => {
  it("shows computed values and raw input separately", () => {
    const e = make({ A1: "2", A2: "=A1*3" });
    expect(e.view(at("A2")).text).toBe("6");
    expect(e.raw(at("A2"))).toBe("=A1*3");
    expect(e.isEmpty(at("B9"))).toBe(true);
  });
  it("recognises dates, percentages, currency and times as typed", () => {
    const e = make({ A1: "1/2/2026", A2: "50%", A3: "$12.50", A4: "€5", A5: "12:30", A6: "=A1+1", A7: "=A1-A1" });
    expect(e.view(at("A1")).auto).toBe("date");
    expect(formatAutoValue(e.view(at("A1")).number!, "date")).toBe("1/2/2026");
    expect(e.view(at("A2")).auto).toBe("percent");
    expect(formatAutoValue(0.5, "percent")).toBe("50%");
    expect(e.view(at("A3")).auto).toBe("usd");
    expect(e.view(at("A4")).auto).toBe("eur");
    expect(e.view(at("A5")).auto).toBe("time");
    expect(formatAutoValue(e.view(at("A5")).number!, "time")).toBe("12:30");
    expect(e.view(at("A6")).auto).toBe("date"); // a date plus a day is still a date
    expect(e.view(at("A7")).auto).toBeNull(); // a difference of dates is a number of days
  });
  it("reads day/month order from the configured locale", () => {
    const us = createSheetEngine({ A1: "1/2/2026" }, "MDY").view(at("A1")).number!;
    const eu = createSheetEngine({ A1: "1/2/2026" }, "DMY").view(at("A1")).number!;
    expect(eu - us).toBe(30); // 1 Feb vs 2 Jan
  });
  it("accepts bare TRUE/FALSE in formulas, grouped numbers, and a missing closing paren", () => {
    const e = make();
    e.setCell(at("A1"), "=IF(TRUE,1,2)");
    e.setCell(at("A2"), "1,234.5");
    e.setCell(at("A3"), "=SUM(A1:A2");
    expect(e.view(at("A1")).text).toBe("1");
    expect(e.view(at("A2")).number).toBe(1234.5);
    expect(e.view(at("A3")).number).toBe(1235.5);
    expect(e.raw(at("A3"))).toBe("=SUM(A1:A2)");
  });
  it("explains errors in plain words", () => {
    const e = make({ A1: "=1/0", A2: "=A2", A3: "=NOPE(1)", A4: "=1+" });
    expect(e.view(at("A1"))).toMatchObject({ text: "#DIV/0!", error: "Division by zero" });
    expect(e.view(at("A2")).error).toMatch(/Circular/);
    expect(e.view(at("A3")).error).toMatch(/NOPE/);
    expect(e.view(at("A4")).error).toBe("This formula has a syntax error");
  });
  it("offers function names for autocomplete", () => {
    expect(make().functionNames).toEqual(expect.arrayContaining(["SUM", "VLOOKUP", "IF"]));
  });
});

describe("loading and saving", () => {
  it("ignores cells outside the grid and does not make loading undoable", () => {
    const e = make({ A1: "1", ZZ1: "2", A999: "3" });
    expect(e.exportCells()).toEqual({ A1: "1" });
    expect(e.undo()).toBe(false);
  });
});

describe("paste, fill and move", () => {
  it("pastes a block with relative references adjusted, starting at the target corner", () => {
    const e = make({ B2: "2", C2: "5", D2: "=B2*C2", B3: "3", C3: "7", D3: "=B3*C3" });
    e.copyInto(box("C2", "D3"), box("F5", "G6"));
    expect(e.raw(at("F5"))).toBe("5");
    expect(e.raw(at("G5"))).toBe("=E5*F5");
    expect(e.raw(at("F6"))).toBe("7");
    expect(e.raw(at("G6"))).toBe("=E6*F6");
  });
  it("tiles a single cell over a larger target", () => {
    const e = make({ A1: "=B1+1" });
    e.copyInto(box("A1", "A1"), box("A3", "B4"));
    expect([e.raw(at("A3")), e.raw(at("B3")), e.raw(at("A4")), e.raw(at("B4"))]).toEqual(["=B3+1", "=C3+1", "=B4+1", "=C4+1"]);
  });
  it("fill continues an evenly spaced run of numbers, in every direction", () => {
    const e = make({ A1: "1", A2: "2", C5: "10", C6: "20" });
    e.copyInto(box("A1", "A2"), box("A3", "A5"), true);
    expect([3, 4, 5].map((r) => e.raw({ row: r - 1, col: 0 }))).toEqual(["3", "4", "5"]);
    e.copyInto(box("C5", "C6"), box("C3", "C4"), true);
    expect([e.raw(at("C3")), e.raw(at("C4"))]).toEqual(["-10", "0"]);
    const h = make({ A1: "5", B1: "10" });
    h.copyInto(box("A1", "B1"), box("C1", "D1"), true);
    expect([h.raw(at("C1")), h.raw(at("D1"))]).toEqual(["15", "20"]);
  });
  it("fill repeats a single number, text, and formulas (adjusted)", () => {
    const e = make({ A1: "7", B1: "x", C1: "=A1*2" });
    e.copyInto(box("A1", "C1"), box("A2", "C3"), true);
    expect([e.raw(at("A3")), e.raw(at("B3")), e.raw(at("C3"))]).toEqual(["7", "x", "=A3*2"]);
  });
  it("move keeps formulas pointing at the moved cells, and refuses to leave the grid", () => {
    const e = make({ A1: "1", B1: "=A1*2", A5: "=B1" });
    expect(e.move(box("A1", "B1"), at("A3"))).toBe(true);
    expect(e.raw(at("B3"))).toBe("=A3*2");
    expect(e.raw(at("A5"))).toBe("=B3");
    expect(e.isEmpty(at("A1"))).toBe(true);
    expect(e.move(box("A3", "B3"), at("Z3"))).toBe(false);
  });
  it("setMatrix drops whatever would land outside the grid", () => {
    const e = make();
    const written = e.setMatrix(at("Y49"), [["a", "b", "c"], ["d", "e", "f"], ["g", "h", "i"]]);
    expect(written).toEqual({ minRow: 48, maxRow: 49, minCol: 24, maxCol: 25 });
    expect(Object.keys(e.exportCells()).sort()).toEqual(["Y49", "Y50", "Z49", "Z50"]);
    expect(e.setMatrix(at("A1"), [])).toBeNull();
  });
});

describe("undo", () => {
  it("every mutation is exactly one undo step", () => {
    const e = make({ A1: "1", A2: "2" });
    e.setCell(at("B1"), "x");
    e.setMatrix(at("C1"), [["a", "b"], ["c", "d"]]);
    e.clear(box("A1", "A2"));
    e.copyInto(box("C1", "D2"), box("C4", "D5"));
    e.move(box("C4", "D5"), at("F4"));
    for (let i = 0; i < 5; i++) expect(e.undo()).toBe(true);
    expect(e.undo()).toBe(false);
    expect(e.exportCells()).toEqual({ A1: "1", A2: "2" });
    for (let i = 0; i < 5; i++) expect(e.redo()).toBe(true);
    expect(e.raw(at("G5"))).toBe("d");
  });
});
