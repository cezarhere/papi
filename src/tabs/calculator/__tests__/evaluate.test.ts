import { beforeAll, describe, expect, it } from "vitest";

// currencyRates.ts reads localStorage at import time (cache lookup).
beforeAll(() => {
  const store = new Map<string, string>();
  (globalThis as unknown as { localStorage: Storage }).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
    key: () => null,
    length: 0,
  };
});

async function run(lines: string[], precision = 2): Promise<string[]> {
  const { evaluateLines } = await import("../evaluateLine");
  return evaluateLines(
    lines.map((raw, i) => ({ id: `l${i}`, raw, result: null, kind: "text" as const })),
    precision,
  ).map((l) => l.result ?? "");
}

describe("arithmetic", () => {
  it("respects precedence and parentheses", async () => {
    expect(await run(["2 + 3 * 4", "(1 + 2) * 3"])).toEqual(["14", "9"]);
  });
  it("groups thousands and honours precision", async () => {
    expect(await run(["1000 * 1000", "10 / 3"], 2)).toEqual(["1,000,000", "3.33"]);
    expect(await run(["10 / 3"], 0)).toEqual(["3"]);
  });
  it("reports Error for a complete but non-finite result", async () => {
    expect(await run(["1/0"])).toEqual(["Error"]);
  });
  it("stays blank while an expression is still being typed", async () => {
    expect(await run(["2 +", "(1 + 2"])).toEqual(["", ""]);
  });
});

describe("scalar functions kept in the trimmed mathjs build", () => {
  it("evaluates the exposed set", async () => {
    expect(
      await run(["sqrt(16)", "abs(0-5)", "round(2.6)", "2^10", "10 mod 3", "factorial(5)", "floor(2.9)", "log10(1000)", "pi * 2"]),
    ).toEqual(["4", "5", "3", "1,024", "1", "120", "2", "3", "6.28"]);
  });
  it("functions that were dropped fail soft rather than crash", async () => {
    expect(await run(["det([[1,2],[3,4]])", "gcd(4, 6)"])).toEqual(["", ""]);
  });
});

describe("variables, labels and prev", () => {
  it("assigns and reuses names", async () => {
    expect(await run(["x = 5", "x + 10"])).toEqual(["5", "15"]);
  });
  it("supports Label: value", async () => {
    expect(await run(["rent: 200", "food: 300", "rent + food"])).toEqual(["200", "300", "500"]);
  });
  it("prev is the last numeric result", async () => {
    expect(await run(["100", "prev * 2"])).toEqual(["100", "200"]);
  });
  it("an undefined name is soft (blank), not an error", async () => {
    expect(await run(["nothing + 1"])).toEqual([""]);
  });
});

describe("aggregates are blank-line-delimited blocks", () => {
  it("sum/average/min/max within a block", async () => {
    expect(await run(["10", "20", "30", "sum", "average", "min", "max"])).toEqual([
      "10", "20", "30", "60", "20", "10", "30",
    ]);
  });
  it("a blank line resets the block", async () => {
    const r = await run(["10", "20", "", "5", "sum"]);
    expect(r[4]).toBe("5");
  });
  it("sum works inside a larger expression", async () => {
    const r = await run(["100", "200", "sum - 100"]);
    expect(r[2]).toBe("200");
  });
});

describe("percentages", () => {
  it("percent of", async () => {
    expect(await run(["20% of 30"])).toEqual(["6"]);
  });
  it("increased/decreased by and +/- shorthand", async () => {
    expect(await run(["100 increased by 20%", "100 decreased by 20%", "100 + 10%", "100 - 10%"])).toEqual([
      "120", "80", "110", "90",
    ]);
  });
  it("accepts a variable or prev as the base", async () => {
    expect(await run(["x = 200", "x increased by 10%", "prev decreased by 50%", "20% of x"])).toEqual([
      "200", "220", "110", "40",
    ]);
  });
  it("unknown base name is blank, not an error", async () => {
    expect(await run(["ghost increased by 5%"])).toEqual([""]);
  });
});

describe("units", () => {
  it("converts mass, length and volume", async () => {
    const r = await run(["5 lb to kg", "1 km to cm", "1 floz to ml"]);
    expect(r).toEqual(["2.27 kg", "100,000 cm", "29.57 ml"]);
  });
  it("temperature and speed", async () => {
    expect(await run(["380 degF to degC", "60 mi/h to km/h"])).toEqual(["193.33 degC", "96.56 km/h"]);
  });
  it("incomplete conversions are soft, not Error", async () => {
    expect(await run(["1km", "1 km to"])).toEqual(["", ""]);
  });
  it("sqft works where m2 → ft2 does not", async () => {
    expect((await run(["100 m2 to sqft"]))[0]).toMatch(/sqft$/);
  });
  it("duration arithmetic uses the first term's unit", async () => {
    expect(await run(["2h + 35min", "35min + 2h", "90min to h"])).toEqual(["2.58 h", "155 min", "1.5 h"]);
  });
});

describe("currency (bundled fallback rates)", () => {
  it("converts and formats with symbol", async () => {
    const [r] = await run(["100 usd to usd"]);
    expect(r).toMatch(/100\.00/);
  });
  it("unknown currency is not a crash", async () => {
    await expect(run(["1 usd to zzz"])).resolves.toHaveLength(1);
  });
});

describe("dates", () => {
  it("resolves relative dates", async () => {
    const [r] = await run(["today"]);
    expect(r).toMatch(/\d{4}/);
  });
  it("weekday + duration keeps the weekday (chrono-node workaround)", async () => {
    const [r] = await run(["next wednesday in 2 weeks"]);
    expect(r).toMatch(/^Wed,/);
  });
});

describe("safety", () => {
  it("mathjs functions that mutate or re-enter the parser are disabled", async () => {
    const { evaluate } = await import("../math");
    for (const expr of [
      "import({ sqrt: 1 }, { override: true })",
      'createUnit("zork")',
      'evaluate("1+1")',
      'parse("1")',
      'simplify("x+x")',
      'derivative("x^2", "x")',
    ]) {
      expect(() => evaluate(expr), expr).toThrow(/disabled/);
    }
    // ...while ordinary math on the same instance is untouched.
    expect(evaluate("2 + 3 * 4")).toBe(14);
  });
  it("a hostile line cannot change later lines' results", async () => {
    const r = await run(["import({ add: 1 }, { override: true })", "2 + 2"]);
    expect(r[1]).toBe("4");
  });
  it("very long and huge-number input does not throw", async () => {
    await expect(run(["9".repeat(400), "1e308 * 10", "1+".repeat(500) + "1"])).resolves.toHaveLength(3);
  });
});
