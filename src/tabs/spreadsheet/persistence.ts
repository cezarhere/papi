import type { CellRawValue } from "./useSpreadsheetEngine";
import { isNumberFormat, MAX_DECIMALS } from "./numberFormat";
import type { CellFormat } from "./types";

const DOCUMENT_VERSION = 1;

export interface SpreadsheetDocument {
  version: number;
  cells: Record<string, CellRawValue>;
  formats: Record<string, CellFormat>;
  // Column index (as a string key) -> width in px. Absent = default width.
  columnWidths: Record<string, number>;
}

export function buildDocument(
  cells: Record<string, CellRawValue>,
  formats: Record<string, CellFormat>,
  columnWidths: Record<string, number> = {},
): SpreadsheetDocument {
  return { version: DOCUMENT_VERSION, cells, formats, columnWidths };
}

const AUTOSAVE_KEY = "spreadsheet-autosave";

// Automatic persistence (CALC_SPEC.md "Autosave") — the only persistence
// path now that manual save/load-to-file has been removed.
export function saveDocumentToStorage(document: SpreadsheetDocument): void {
  localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(document));
}

// Unlike parseDocument, this never throws — corrupted or missing
// autosave data just means starting fresh, not a user-facing error.
export function loadDocumentFromStorage(): SpreadsheetDocument | null {
  const raw = localStorage.getItem(AUTOSAVE_KEY);
  if (raw === null) return null;
  try {
    return parseDocument(raw);
  } catch {
    return null;
  }
}

function isCellFormat(value: unknown): value is CellFormat {
  if (typeof value !== "object" || value === null) return false;
  const format = value as Record<string, unknown>;
  return (
    (format.bold === undefined || typeof format.bold === "boolean") &&
    (format.italic === undefined || typeof format.italic === "boolean") &&
    (format.fill === undefined || typeof format.fill === "string") &&
    (format.numberFormat === undefined || isNumberFormat(format.numberFormat)) &&
    (format.decimals === undefined ||
      (Number.isInteger(format.decimals) && (format.decimals as number) >= 0 && (format.decimals as number) <= MAX_DECIMALS))
  );
}

function isCellRawValue(value: unknown): value is CellRawValue {
  return value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean";
}

// Parses and lightly validates a loaded file's contents. Throws with a
// human-readable message on anything malformed, rather than silently
// applying partial/garbage data.
export function parseDocument(json: string): SpreadsheetDocument {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    throw new Error("That file isn't valid JSON.");
  }
  if (typeof raw !== "object" || raw === null) {
    throw new Error("That file doesn't look like a saved spreadsheet.");
  }
  const candidate = raw as Record<string, unknown>;

  const cells: Record<string, CellRawValue> = {};
  if (candidate.cells !== undefined) {
    if (typeof candidate.cells !== "object" || candidate.cells === null) {
      throw new Error("That file's \"cells\" field is malformed.");
    }
    for (const [key, value] of Object.entries(candidate.cells as Record<string, unknown>)) {
      if (isCellRawValue(value)) cells[key] = value;
    }
  }

  const formats: Record<string, CellFormat> = {};
  if (candidate.formats !== undefined) {
    if (typeof candidate.formats !== "object" || candidate.formats === null) {
      throw new Error("That file's \"formats\" field is malformed.");
    }
    for (const [key, value] of Object.entries(candidate.formats as Record<string, unknown>)) {
      if (isCellFormat(value)) formats[key] = value;
    }
  }

  const columnWidths: Record<string, number> = {};
  if (candidate.columnWidths !== undefined) {
    if (typeof candidate.columnWidths !== "object" || candidate.columnWidths === null) {
      throw new Error("That file's \"columnWidths\" field is malformed.");
    }
    for (const [key, value] of Object.entries(candidate.columnWidths as Record<string, unknown>)) {
      if (/^\d+$/.test(key) && typeof value === "number" && Number.isFinite(value)) columnWidths[key] = value;
    }
  }

  return { version: DOCUMENT_VERSION, cells, formats, columnWidths };
}
