// Display-only number formatting (formatting lives outside HyperFormula, see
// SPEC.md): the engine always holds the raw number; these just choose how a
// numeric result is shown. Non-numeric results (text, errors) are never
// touched by any of this.

export type NumberFormat = "number" | "usd" | "eur" | "gbp" | "percent" | "date";

export const NUMBER_FORMAT_OPTIONS: { value: NumberFormat | "general"; label: string }[] = [
  { value: "general", label: "General" },
  { value: "number", label: "Number" },
  { value: "usd", label: "Currency ($)" },
  { value: "eur", label: "Currency (€)" },
  { value: "gbp", label: "Currency (£)" },
  { value: "percent", label: "Percent" },
  { value: "date", label: "Date" },
];

export const MAX_DECIMALS = 10;

const NUMBER_FORMATS = new Set<string>(["number", "usd", "eur", "gbp", "percent", "date"]);
export function isNumberFormat(value: unknown): value is NumberFormat {
  return typeof value === "string" && NUMBER_FORMATS.has(value);
}

// What "no explicit decimals" means for each format.
export function defaultDecimals(format: NumberFormat): number {
  return format === "date" ? 0 : 2;
}

const CURRENCY_CODE: Record<"usd" | "eur" | "gbp", string> = { usd: "USD", eur: "EUR", gbp: "GBP" };

// Spreadsheet date serials count days since 1899-12-30 (the Excel/Sheets
// epoch HyperFormula also uses); 25569 is the offset to the Unix epoch.
const SERIAL_UNIX_OFFSET = 25569;
const MS_PER_DAY = 86_400_000;

export function formatNumberValue(value: number, format: NumberFormat, decimals?: number): string {
  if (!Number.isFinite(value)) return String(value);
  const digits = Math.min(MAX_DECIMALS, Math.max(0, decimals ?? defaultDecimals(format)));

  switch (format) {
    case "number":
      return value.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
    case "usd":
    case "eur":
    case "gbp":
      return value.toLocaleString("en-US", {
        style: "currency",
        currency: CURRENCY_CODE[format],
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
      });
    case "percent":
      return value.toLocaleString("en-US", {
        style: "percent",
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
      });
    case "date": {
      const date = new Date((value - SERIAL_UNIX_OFFSET) * MS_PER_DAY);
      if (Number.isNaN(date.getTime())) return String(value);
      return date.toLocaleDateString("en-US", { timeZone: "UTC", year: "numeric", month: "short", day: "numeric" });
    }
  }
}

// Used for the selection summary bar: grouped, trimmed to a sensible
// precision so 0.1 + 0.2 reads "0.3", not 0.30000000000000004.
export function formatPlainNumber(value: number): string {
  return value.toLocaleString("en-US", { maximumFractionDigits: 6 });
}
