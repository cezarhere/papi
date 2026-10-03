import { describe, expect, it } from "vitest";
import { formatNumberValue, formatPlainNumber, isNumberFormat } from "../numberFormat";
import { summarize } from "../summary";

describe("formatNumberValue", () => {
  it("number: grouping and fixed decimals", () => {
    expect(formatNumberValue(1234567.891, "number")).toBe("1,234,567.89");
    expect(formatNumberValue(1234.5, "number", 0)).toBe("1,235");
    expect(formatNumberValue(2, "number", 4)).toBe("2.0000");
  });
  it("currencies", () => {
    expect(formatNumberValue(1234.5, "usd")).toBe("$1,234.50");
    expect(formatNumberValue(1234.5, "eur")).toBe("€1,234.50");
    expect(formatNumberValue(1234.5, "gbp")).toBe("£1,234.50");
    expect(formatNumberValue(-5, "usd")).toBe("-$5.00");
    expect(formatNumberValue(1234.5, "usd", 0)).toBe("$1,235");
  });
  it("percent treats 0.125 as 12.5%", () => {
    expect(formatNumberValue(0.125, "percent")).toBe("12.50%");
    expect(formatNumberValue(0.125, "percent", 0)).toBe("13%");
    expect(formatNumberValue(1, "percent", 0)).toBe("100%");
  });
  it("date converts spreadsheet serials (days since 1899-12-30)", () => {
    expect(formatNumberValue(25569, "date")).toBe("Jan 1, 1970");
    expect(formatNumberValue(45292, "date")).toBe("Jan 1, 2024");
    expect(formatNumberValue(45292.75, "date")).toBe("Jan 1, 2024");
  });
  it("never throws on odd input and clamps decimals", () => {
    expect(formatNumberValue(NaN, "number")).toBe("NaN");
    expect(formatNumberValue(Infinity, "usd")).toBe("Infinity");
    expect(formatNumberValue(1e300, "date")).toBe(String(1e300));
    expect(() => formatNumberValue(1, "number", 99)).not.toThrow();
    expect(() => formatNumberValue(1, "number", -3)).not.toThrow();
  });
  it("validates stored format names", () => {
    expect(isNumberFormat("usd")).toBe(true);
    expect(isNumberFormat("general")).toBe(false);
    expect(isNumberFormat(5)).toBe(false);
  });
  it("plain number trims floating-point noise", () => {
    expect(formatPlainNumber(0.1 + 0.2)).toBe("0.3");
    expect(formatPlainNumber(1234567)).toBe("1,234,567");
  });
});

describe("summarize", () => {
  it("computes count, sum, average, min and max", () => {
    expect(summarize([10, 20, 30])).toEqual({ count: 3, sum: 60, average: 20, min: 10, max: 30 });
  });
  it("handles negatives and ignores non-finite values", () => {
    expect(summarize([-5, 5, NaN, Infinity])).toEqual({ count: 2, sum: 0, average: 0, min: -5, max: 5 });
  });
  it("returns null when nothing is numeric", () => {
    expect(summarize([])).toBeNull();
    expect(summarize([NaN])).toBeNull();
  });
});
