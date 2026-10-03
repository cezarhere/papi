const STORAGE_KEY = "calculator-autosave";
const DOCUMENT_VERSION = 1;

interface CalculatorDocument {
  version: number;
  lines: string[];
}

// Automatic persistence (CALC_SPEC.md "Autosave") — only the raw text
// per line is saved. Ids, results, and kinds are all regenerated or
// recomputed on load, so there's nothing meaningful to persist there.
export function saveCalculatorState(lines: string[]): void {
  const document: CalculatorDocument = { version: DOCUMENT_VERSION, lines };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(document));
}

// Never throws — corrupted or missing autosave data just means
// starting fresh, not a user-facing error.
export function loadCalculatorState(): string[] | null {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw === null) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;
    const { lines } = parsed as Record<string, unknown>;
    if (!Array.isArray(lines) || !lines.every((line) => typeof line === "string")) {
      return null;
    }
    return lines;
  } catch {
    return null;
  }
}
