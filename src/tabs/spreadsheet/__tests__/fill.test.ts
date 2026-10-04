import { describe, expect, it } from "vitest";
import { HyperFormula } from "hyperformula";
import { computeFillTarget, unionBounds } from "../fill";

const sel = { minRow: 3, maxRow: 4, minCol: 2, maxCol: 3 }; // C4:D5

describe("computeFillTarget", () => {
  it("fills down, spanning the selection's columns", () => {
    expect(computeFillTarget(sel, { row: 8, col: 3 }, 50, 26)).toEqual({ minRow: 5, maxRow: 8, minCol: 2, maxCol: 3 });
  });
  it("fills up", () => {
    expect(computeFillTarget(sel, { row: 0, col: 2 }, 50, 26)).toEqual({ minRow: 0, maxRow: 2, minCol: 2, maxCol: 3 });
  });
  it("fills right, spanning the selection's rows (the case that used to do nothing)", () => {
    expect(computeFillTarget(sel, { row: 4, col: 7 }, 50, 26)).toEqual({ minRow: 3, maxRow: 4, minCol: 4, maxCol: 7 });
  });
  it("fills left", () => {
    expect(computeFillTarget(sel, { row: 3, col: 0 }, 50, 26)).toEqual({ minRow: 3, maxRow: 4, minCol: 0, maxCol: 1 });
  });
  it("picks the axis the cursor is furthest outside; ties go vertical", () => {
    expect(computeFillTarget(sel, { row: 6, col: 9 }, 50, 26)?.minCol).toBe(4); // right is further
    expect(computeFillTarget(sel, { row: 6, col: 6 }, 50, 26)).toEqual({ minRow: 3, maxRow: 4, minCol: 4, maxCol: 6 }); // 2 down vs 3 right -> right
    expect(computeFillTarget({ minRow: 1, maxRow: 1, minCol: 1, maxCol: 1 }, { row: 3, col: 3 }, 50, 26)).toEqual({
      minRow: 2, maxRow: 3, minCol: 1, maxCol: 1,
    });
  });
  it("does nothing while the cursor is inside the selection", () => {
    expect(computeFillTarget(sel, { row: 4, col: 3 }, 50, 26)).toBeNull();
    expect(computeFillTarget(sel, { row: 3, col: 2 }, 50, 26)).toBeNull();
  });
  it("never extends past the grid", () => {
    expect(computeFillTarget(sel, { row: 49, col: 3 }, 40, 26)?.maxRow).toBe(39);
    expect(computeFillTarget(sel, { row: 4, col: 30 }, 50, 10)?.maxCol).toBe(9);
  });
});

describe("unionBounds", () => {
  it("covers both ranges", () => {
    expect(unionBounds(sel, { minRow: 3, maxRow: 4, minCol: 4, maxCol: 7 })).toEqual({ minRow: 3, maxRow: 4, minCol: 2, maxCol: 7 });
  });
});

describe("HyperFormula fill in every direction (relative references adjust)", () => {
  const make = () => {
    const hf = HyperFormula.buildEmpty({ licenseKey: "gpl-v3" });
    hf.addSheet("S");
    return hf;
  };
  const range = (r1: number, c1: number, r2: number, c2: number) => ({
    start: { sheet: 0, row: r1, col: c1 },
    end: { sheet: 0, row: r2, col: c2 },
  });
  const fill = (hf: HyperFormula, src: ReturnType<typeof range>, tgt: ReturnType<typeof range>) =>
    hf.setCellContents(tgt.start, hf.getFillRangeData(src, tgt));

  it("down, right, up and left", () => {
    const hf = make();
    hf.setCellContents({ sheet: 0, row: 10, col: 10 }, [["=A9+B9"]]); // K11, away from every edge
    fill(hf, range(10, 10, 10, 10), range(11, 10, 12, 10)); // down
    fill(hf, range(10, 10, 10, 10), range(10, 11, 10, 12)); // right
    fill(hf, range(10, 10, 10, 10), range(8, 10, 9, 10)); // up
    fill(hf, range(10, 10, 10, 10), range(10, 8, 10, 9)); // left
    const f = (r: number, c: number) => hf.getCellSerialized({ sheet: 0, row: r, col: c });
    expect(f(11, 10)).toBe("=A10+B10");
    expect(f(12, 10)).toBe("=A11+B11");
    expect(f(10, 11)).toBe("=B9+C9");
    expect(f(10, 12)).toBe("=C9+D9");
    expect(f(9, 10)).toBe("=A8+B8");
    expect(f(10, 9)).toBe("=#REF!+A9");
  });
});
