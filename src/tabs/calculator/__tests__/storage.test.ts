import { beforeEach, describe, expect, it, vi } from "vitest";

const store = new Map<string, string>();
beforeEach(() => {
  store.clear();
  vi.resetModules();
  (globalThis as unknown as { localStorage: Storage }).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
    key: () => null,
    length: 0,
  };
});

describe("calculator persistence", () => {
  it("round-trips lines", async () => {
    const { saveCalculatorState, loadCalculatorState } = await import("../persistence");
    saveCalculatorState(["1+1", "", "x = 3"]);
    expect(loadCalculatorState()).toEqual(["1+1", "", "x = 3"]);
  });
  it.each([["not json"], ['{"lines": "nope"}'], ['{"lines": [1,2]}'], ["null"], ["42"]])(
    "corrupt data (%s) loads as null instead of throwing",
    async (raw) => {
      store.set("calculator-autosave", raw);
      const { loadCalculatorState } = await import("../persistence");
      expect(loadCalculatorState()).toBeNull();
    },
  );
});

describe("currency rates", () => {
  const okResponse = (rates: unknown) =>
    ({ ok: true, json: async () => ({ rates }) }) as Response;

  it("ignores zero, negative, NaN and non-numeric rates from the API", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => okResponse({ EUR: 0.9, GBP: 0, CHF: -1, JPY: "x" })));
    const { initCurrencyRates, getCurrencyRates } = await import("../currencyRates");
    await initCurrencyRates();
    const rates = getCurrencyRates();
    expect(rates.EUR.rate).toBe(0.9);
    expect(rates.GBP).toBeUndefined();
    expect(rates.CHF).toBeUndefined();
    expect(rates.JPY).toBeUndefined();
  });
  it("keeps the previous rates when the request fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
    const { initCurrencyRates, getCurrencyRates } = await import("../currencyRates");
    const before = getCurrencyRates();
    await initCurrencyRates();
    expect(getCurrencyRates()).toBe(before);
  });
  it("does not refetch while the cache is fresh", async () => {
    const fetchMock = vi.fn(async () => okResponse({ EUR: 0.9 }));
    vi.stubGlobal("fetch", fetchMock);
    const { initCurrencyRates } = await import("../currencyRates");
    await initCurrencyRates();
    await initCurrencyRates();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("a non-ok response or malformed body leaves rates alone", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false }) as Response));
    const m1 = await import("../currencyRates");
    const before = m1.getCurrencyRates();
    await m1.initCurrencyRates();
    expect(m1.getCurrencyRates()).toBe(before);
    vi.resetModules();
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ rates: null }) }) as Response));
    const m2 = await import("../currencyRates");
    const b2 = m2.getCurrencyRates();
    await m2.initCurrencyRates();
    expect(m2.getCurrencyRates()).toBe(b2);
  });
});
