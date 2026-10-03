import { describe, expect, it } from "vitest";
import { parseFormulaRefs, refEdgesForCell } from "../formulaRefs";

const refs = (f: string) => parseFormulaRefs(f, 50, 26);

describe("parseFormulaRefs", () => {
  it("finds single cells and ranges, with or without $", () => {
    expect(refs("=A1+B2")).toEqual([
      { minRow: 0, maxRow: 0, minCol: 0, maxCol: 0 },
      { minRow: 1, maxRow: 1, minCol: 1, maxCol: 1 },
    ]);
    expect(refs("=SUM($B$2:C4)")).toEqual([{ minRow: 1, maxRow: 3, minCol: 1, maxCol: 2 }]);
    expect(refs("=sum(c4:b2)")).toEqual([{ minRow: 1, maxRow: 3, minCol: 1, maxCol: 2 }]);
  });
  it("ignores non-formulas, string literals and function names that look like cells", () => {
    expect(refs("A1+B2")).toEqual([]);
    expect(refs('="A1"&B1')).toEqual([{ minRow: 0, maxRow: 0, minCol: 1, maxCol: 1 }]);
    expect(refs("=LOG10(100)+ATAN2(1,2)")).toEqual([]);
  });
  it("drops references outside the grid", () => {
    expect(refs("=AA1+A51+Z50")).toEqual([{ minRow: 49, maxRow: 49, minCol: 25, maxCol: 25 }]);
  });
  it("copes with half-typed formulas", () => {
    expect(() => refs("=SUM(A1:")).not.toThrow();
    expect(refs("=SUM(A1:")).toEqual([{ minRow: 0, maxRow: 0, minCol: 0, maxCol: 0 }]);
  });
});

describe("refEdgesForCell", () => {
  const block = [{ minRow: 1, maxRow: 2, minCol: 1, maxCol: 2 }];
  it("outlines only the outer edge of a range", () => {
    expect(refEdgesForCell(1, 1, block)).toEqual({ top: true, left: true, right: false, bottom: false });
    expect(refEdgesForCell(2, 2, block)).toEqual({ top: false, left: false, right: true, bottom: true });
    expect(refEdgesForCell(0, 0, block)).toBeNull();
  });
  it("a single-cell ref gets all four sides", () => {
    expect(refEdgesForCell(0, 0, [{ minRow: 0, maxRow: 0, minCol: 0, maxCol: 0 }])).toEqual({
      top: true, right: true, bottom: true, left: true,
    });
  });
  it("separate adjacent refs each keep their own outline", () => {
    const two = [
      { minRow: 0, maxRow: 0, minCol: 0, maxCol: 0 },
      { minRow: 1, maxRow: 1, minCol: 0, maxCol: 0 },
    ];
    expect(refEdgesForCell(0, 0, two)?.bottom).toBe(true);
    expect(refEdgesForCell(1, 0, two)?.top).toBe(true);
  });
});
