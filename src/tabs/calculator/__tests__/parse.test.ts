import { beforeAll, describe, expect, it } from "vitest";
import { classifyLine } from "../classifyLine";
import { tokenize } from "../tokenize";

beforeAll(() => {
  // evaluateLine -> currencyRates reads localStorage at import time.
  (globalThis as unknown as { localStorage: Pick<Storage, "getItem" | "setItem"> }).localStorage = {
    getItem: () => null,
    setItem: () => {},
  };
});

const kind = (raw: string) => classifyLine(tokenize(raw), raw).kind;

describe("tokenize", () => {
  it("splits numbers, identifiers, operators and percent", () => {
    expect(tokenize("20% of x").map((t) => t.type)).toEqual(["number", "percent", "identifier", "identifier"]);
  });
  it("keeps m2 and hyphenated names as one identifier, but splits 2kg", () => {
    expect(tokenize("m2").map((t) => t.value)).toEqual(["m2"]);
    expect(tokenize("bogus-unit").map((t) => t.value)).toEqual(["bogus-unit"]);
    expect(tokenize("2kg").map((t) => t.value)).toEqual(["2", "kg"]);
  });
  it("handles decimals and a leading dot", () => {
    expect(tokenize("1.5 + .5").map((t) => t.value)).toEqual(["1.5", "+", ".5"]);
  });
  it("never throws on arbitrary input", () => {
    for (const s of ["", "   ", "\t", "💥 ünï", "((((", "%%%", "\u0000"]) {
      expect(() => tokenize(s)).not.toThrow();
    }
  });
});

describe("classifyLine", () => {
  it.each([
    ["x = 5", "assignment"],
    ["Rent: 1200", "assignment"],
    ["sum", "aggregate"],
    ["average", "aggregate"],
    ["5 lb to kg", "conversion"],
    ["60 mi/h to km/h", "conversion"],
    ["2h + 35min", "duration"],
    ["20% of 30", "percent-of"],
    ["20% of rent", "percent-of"],
    ["100 increased by 5%", "percent-change"],
    ["prev decreased by 5%", "percent-change"],
    ["100 + 10%", "percent-change"],
    ["2 + 3 * 4", "arithmetic"],
    ["", "text"],
  ])("%s -> %s", (raw, expected) => {
    expect(kind(raw)).toBe(expected);
  });

  it("free-form notes classify loosely but never produce a result", async () => {
    const { evaluateLines } = await import("../evaluateLine");
    const [line] = evaluateLines([{ id: "n", raw: "just some notes", result: null, kind: "text" }], 2);
    expect(line.result).toBeNull();
  });

  it("a bare 'name:' or 'name =' with no value is plain text", () => {
    expect(kind("rent:")).toBe("text");
    expect(kind("x =")).toBe("text");
  });

  it("percent shapes carry the raw base token for later scope lookup", () => {
    const shape = classifyLine(tokenize("rent increased by 5%"), "rent increased by 5%");
    expect(shape).toMatchObject({ kind: "percent-change", base: "rent", percent: 5, direction: "increase" });
  });
});
