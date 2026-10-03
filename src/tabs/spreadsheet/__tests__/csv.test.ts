import { describe, expect, it } from "vitest";
import { parseCsv, toCsv } from "../csv";

describe("csv", () => {
  it("round-trips commas, quotes and newlines", () => {
    const rows = [["a,b", 'say "hi"', "line1\nline2"], ["1", "", "x"]];
    expect(parseCsv(toCsv(rows))).toEqual(rows);
  });
  it("parses CRLF, LF, a BOM and a missing final newline", () => {
    expect(parseCsv("﻿a,b\r\nc,d\ne,f")).toEqual([["a", "b"], ["c", "d"], ["e", "f"]]);
  });
  it("keeps empty fields and trailing empties", () => {
    expect(parseCsv("a,,c,\n,,")).toEqual([["a", "", "c", ""], ["", "", ""]]);
  });
  it("empty input is no rows", () => {
    expect(parseCsv("")).toEqual([]);
    expect(toCsv([])).toBe("");
  });
  it("tolerates an unterminated quote without throwing", () => {
    expect(() => parseCsv('a,"b')).not.toThrow();
  });
  it("neutralizes formula-looking text on export but not numbers", () => {
    const out = toCsv([["=HYPERLINK(\"x\")", "+1+1", "@SUM(A1)", "-5", "-1.5", "-text"]]);
    expect(out).toBe(`"'=HYPERLINK(""x"")",'+1+1,'@SUM(A1),-5,-1.5,'-text\r\n`);
  });
});
