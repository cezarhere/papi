import { describe, expect, it } from "vitest";
import { HyperFormula } from "hyperformula";
import { addressKey, formatRangeReference, parseAddressKey } from "../address";
import { normalizeRange } from "../range";
import { buildDocument, parseDocument } from "../persistence";
import { columnLabel } from "../utils";

describe("addresses", () => {
  it("round-trips A1 keys, including multi-letter columns", () => {
    for (const key of ["A1", "G25", "Z1", "AA10", "AZ3"]) {
      const addr = parseAddressKey(key)!;
      expect(addressKey(addr)).toBe(key);
    }
    expect(columnLabel(0)).toBe("A");
    expect(columnLabel(26)).toBe("AA");
  });
  it("rejects malformed keys", () => {
    for (const bad of ["", "1A", "A", "A0x", "A-1", "__proto__"]) {
      expect(parseAddressKey(bad), bad).toBeNull();
    }
  });
  it("formats cell and range references regardless of drag direction", () => {
    const a = { row: 2, col: 1 };
    const b = { row: 0, col: 0 };
    expect(formatRangeReference({ anchor: a, focus: a })).toBe("B3");
    expect(formatRangeReference({ anchor: a, focus: b })).toBe("A1:B3");
    expect(normalizeRange({ anchor: a, focus: b })).toEqual({ minRow: 0, maxRow: 2, minCol: 0, maxCol: 1 });
  });
});

describe("spreadsheet persistence", () => {
  it("round-trips a document", () => {
    const doc = buildDocument({ A1: 1, B2: "=A1*2", C3: "hi", D4: true, E5: null }, { A1: { bold: true, fill: "#ff0" } });
    expect(parseDocument(JSON.stringify(doc))).toEqual(doc);
  });
  it("drops invalid cells/formats instead of applying garbage", () => {
    const parsed = parseDocument(JSON.stringify({ cells: { A1: { x: 1 }, B1: 2 }, formats: { A1: { bold: "yes" }, B1: { italic: true } } }));
    expect(parsed.cells).toEqual({ B1: 2 });
    expect(parsed.formats).toEqual({ B1: { italic: true } });
  });
  it.each([["nope"], ["null"], ['{"cells": 5}'], ['{"formats": null}']])("rejects %s with a readable error", (raw) => {
    expect(() => parseDocument(raw)).toThrow();
  });
  it("does not pollute prototypes via __proto__ keys", () => {
    parseDocument('{"cells": {"__proto__": 1}, "formats": {"__proto__": {"bold": true}}}');
    expect(({} as Record<string, unknown>).bold).toBeUndefined();
  });
});

describe("HyperFormula under the app's configuration", () => {
  const make = () => {
    const hf = HyperFormula.buildEmpty({ licenseKey: "gpl-v3" });
    hf.addSheet("Sheet1");
    return hf;
  };
  it("computes formulas and recalculates dependents", () => {
    const hf = make();
    hf.setCellContents({ sheet: 0, row: 0, col: 0 }, "2");
    hf.setCellContents({ sheet: 0, row: 1, col: 0 }, "=A1*3");
    expect(hf.getCellValue({ sheet: 0, row: 1, col: 0 })).toBe(6);
    hf.setCellContents({ sheet: 0, row: 0, col: 0 }, "5");
    expect(hf.getCellValue({ sheet: 0, row: 1, col: 0 })).toBe(15);
  });
  it("circular references and bad formulas become error values, not exceptions", () => {
    const hf = make();
    hf.setCellContents({ sheet: 0, row: 0, col: 0 }, "=B1");
    hf.setCellContents({ sheet: 0, row: 0, col: 1 }, "=A1");
    hf.setCellContents({ sheet: 0, row: 1, col: 0 }, "=1/0");
    hf.setCellContents({ sheet: 0, row: 2, col: 0 }, "=NOPE(1)");
    for (const row of [0, 1, 2]) {
      expect(hf.getCellValue({ sheet: 0, row, col: 0 })).toHaveProperty("type");
    }
  });
  it("undo restores the previous content", () => {
    const hf = make();
    hf.setCellContents({ sheet: 0, row: 0, col: 0 }, "1");
    hf.setCellContents({ sheet: 0, row: 0, col: 0 }, "2");
    hf.undo();
    expect(hf.getCellValue({ sheet: 0, row: 0, col: 0 })).toBe(1);
  });
});
