import staticRates from "./currencyRates.json";

export interface CurrencyRate {
  symbol: string;
  rate: number;
}

const CACHE_KEY = "currency-rates-cache";
const REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000;
const API_URL = "https://api.frankfurter.dev/v1/latest?from=USD&to=EUR,GBP,CHF,JPY";

interface RateCache {
  fetchedAt: number;
  rates: Record<string, CurrencyRate>;
}

function loadCache(): RateCache | null {
  const raw = localStorage.getItem(CACHE_KEY);
  if (raw === null) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;
    const { fetchedAt, rates } = parsed as Record<string, unknown>;
    if (typeof fetchedAt !== "number" || typeof rates !== "object" || rates === null) {
      return null;
    }
    return { fetchedAt, rates: rates as Record<string, CurrencyRate> };
  } catch {
    return null;
  }
}

function saveCache(cache: RateCache): void {
  localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
}

// Module-level, mutable, read fresh by evaluateLine.ts on every currency
// conversion — starts as whatever's cached (read synchronously here, so
// a fresh cache is available from the very first render), falling back
// to the bundled static table if there's no cache yet. initCurrencyRates
// below updates this in place once a live fetch resolves.
let currentRates: Record<string, CurrencyRate> = loadCache()?.rates ?? staticRates.currencies;

export function getCurrencyRates(): Record<string, CurrencyRate> {
  return currentRates;
}

async function fetchLiveRates(): Promise<Record<string, CurrencyRate> | null> {
  try {
    const response = await fetch(API_URL, { signal: AbortSignal.timeout(8000) });
    if (!response.ok) return null;
    const data: unknown = await response.json();
    const rates = (data as { rates?: unknown }).rates;
    if (typeof rates !== "object" || rates === null) return null;

    const symbols: Record<string, string> = Object.fromEntries(
      Object.entries(staticRates.currencies).map(([code, entry]) => [code, entry.symbol]),
    );
    const result: Record<string, CurrencyRate> = { USD: { symbol: symbols.USD ?? "$", rate: 1 } };
    for (const [code, rate] of Object.entries(rates as Record<string, unknown>)) {
      // A zero/negative/NaN rate would be cached for a day and silently
      // produce garbage (or divide by zero) in every conversion.
      if (typeof rate !== "number" || !Number.isFinite(rate) || rate <= 0) continue;
      result[code] = { symbol: symbols[code] ?? "", rate };
    }
    return result;
  } catch {
    return null;
  }
}

// Fetch-once-on-launch (CALC_SPEC.md "Currency"): a network call per
// keystroke would work against the app opening instantly from a
// background shortcut, so this only ever runs once per launch (called
// from App.tsx on mount), and only actually fetches if the cache is
// missing or stale. Any failure — offline, API down — just leaves
// currentRates as whatever was already loaded; there's no user-facing
// error path here, staleness is the acceptable degradation.
export async function initCurrencyRates(): Promise<void> {
  const cache = loadCache();
  if (cache && Date.now() - cache.fetchedAt < REFRESH_INTERVAL_MS) return;

  const fetched = await fetchLiveRates();
  if (!fetched) return;

  currentRates = fetched;
  saveCache({ fetchedAt: Date.now(), rates: fetched });
}
