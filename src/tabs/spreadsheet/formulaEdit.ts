// Pure helpers for typing formulas: tidying input on commit, working out
// what a clicked cell should do to the formula being edited, function-name
// autocomplete, and F4's absolute/relative toggle.

export function isFormula(value: string): boolean {
  return value.startsWith("=");
}

// Appends the closing parentheses a formula is missing (=SUM(A1:A3 →
// =SUM(A1:A3)), ignoring anything inside "string literals" — Excel does the
// same instead of reporting an error.
export function closeParens(formula: string): string {
  let depth = 0;
  let inString = false;
  for (const char of formula) {
    if (char === '"') inString = !inString;
    else if (!inString && char === "(") depth++;
    else if (!inString && char === ")") depth = Math.max(0, depth - 1);
  }
  if (inString) return formula;
  return depth > 0 ? formula + ")".repeat(depth) : formula;
}

const GROUPED_NUMBER = /^[-+]?[$€£]?\d{1,3}(,\d{3})+(\.\d+)?%?$/;

// What actually gets stored when a cell edit is committed.
export function normalizeCellInput(raw: string): string {
  if (isFormula(raw)) return closeParens(raw);
  // "1,234.50" is a number in every spreadsheet, but the engine can't take
  // a thousands separator (it clashes with the argument separator).
  const trimmed = raw.trim();
  if (GROUPED_NUMBER.test(trimmed)) return trimmed.replace(/,/g, "");
  return raw;
}

const WHOLE_REF = /^\$?[A-Za-z]{1,2}\$?\d{1,3}(?::\$?[A-Za-z]{1,2}\$?\d{1,3})?$/;
const OPERAND_EXPECTED = "=+-*/^(,&<>;";

// Where a cell picked with the mouse (or arrow keys) goes in the formula
// being edited, as the [start, end) span of text it replaces:
//  - a selected stretch of text is replaced;
//  - right after an operator, "(" or "," the reference is inserted;
//  - right after another reference, that reference is replaced (clicking
//    B1 after typing =A1 gives =B1, not =A1B1);
//  - anywhere else there's nowhere sensible to put one: null, and the
//    caller commits the edit instead, like Excel.
export function refInsertionSpan(
  value: string,
  selectionStart: number,
  selectionEnd: number,
): { start: number; end: number } | null {
  if (!isFormula(value)) return null;
  if (selectionEnd > selectionStart) return { start: selectionStart, end: selectionEnd };
  const before = value.slice(0, selectionStart);
  // The run of reference-ish characters the caret is in or right after.
  const left = /[$A-Za-z0-9:]*$/.exec(before)?.[0] ?? "";
  const right = /^[$A-Za-z0-9:]*/.exec(value.slice(selectionStart))?.[0] ?? "";
  if (left !== "") {
    const start = selectionStart - left.length;
    const end = selectionStart + right.length;
    const previous = value[start - 1] ?? "";
    const isRef = WHOLE_REF.test(left + right) && !/[_."]/.test(previous) && value[end] !== "(";
    return isRef ? { start, end } : null;
  }
  const trimmed = before.trimEnd();
  const last = trimmed[trimmed.length - 1] ?? "";
  if (OPERAND_EXPECTED.includes(last)) return { start: selectionStart, end: selectionStart };
  return null;
}

export function replaceSpan(value: string, span: { start: number; end: number }, text: string): string {
  return value.slice(0, span.start) + text + value.slice(span.end);
}

// The partial function name being typed at the caret (=SU| → "SU"), if the
// caret is somewhere a function name could go.
export function functionTokenAt(value: string, caret: number): { start: number; token: string } | null {
  if (!isFormula(value)) return null;
  const before = value.slice(0, caret);
  // An odd number of quotes means the caret is inside a string literal.
  if ((before.match(/"/g)?.length ?? 0) % 2 === 1) return null;
  const match = /[A-Za-z][A-Za-z0-9.]*$/.exec(before);
  if (!match) return null;
  const previous = before[match.index - 1] ?? "";
  if (/[A-Za-z0-9_.$:")]/.test(previous)) return null;
  const next = value[caret] ?? "";
  if (/[A-Za-z0-9_.(]/.test(next)) return null;
  return { start: match.index, token: match[0] };
}

// Shown first when they match, ahead of the alphabetical rest.
const COMMON_FUNCTIONS = [
  "SUM", "AVERAGE", "COUNT", "MIN", "MAX", "IF", "ROUND", "SUMIF", "COUNTIF", "AVERAGEIF",
  "VLOOKUP", "XLOOKUP", "INDEX", "MATCH", "IFERROR", "AND", "OR", "NOT", "ABS", "TODAY",
  "NOW", "DATE", "CONCATENATE", "LEN", "LEFT", "RIGHT", "MID", "COUNTA", "MEDIAN", "PMT",
];

export const MAX_SUGGESTIONS = 6;

export function suggestFunctions(token: string, names: readonly string[]): string[] {
  const prefix = token.toUpperCase();
  if (prefix === "") return [];
  const common = COMMON_FUNCTIONS.filter((name) => name.startsWith(prefix) && names.includes(name));
  const rest = names.filter((name) => name.startsWith(prefix) && !common.includes(name));
  return [...common, ...rest].slice(0, MAX_SUGGESTIONS);
}

// One-line argument hints for the functions people actually reach for.
export const FUNCTION_HINTS: Record<string, string> = {
  SUM: "number1, number2, …",
  AVERAGE: "number1, number2, …",
  COUNT: "value1, value2, …",
  COUNTA: "value1, value2, …",
  MIN: "number1, number2, …",
  MAX: "number1, number2, …",
  MEDIAN: "number1, number2, …",
  IF: "condition, value_if_true, value_if_false",
  IFERROR: "value, value_if_error",
  ROUND: "number, digits",
  ROUNDUP: "number, digits",
  ROUNDDOWN: "number, digits",
  SUMIF: "range, criterion, sum_range",
  COUNTIF: "range, criterion",
  AVERAGEIF: "range, criterion, average_range",
  VLOOKUP: "search_key, range, index, is_sorted",
  XLOOKUP: "search_key, lookup_range, result_range",
  INDEX: "range, row, column",
  MATCH: "search_key, range, match_type",
  AND: "condition1, condition2, …",
  OR: "condition1, condition2, …",
  NOT: "condition",
  ABS: "number",
  DATE: "year, month, day",
  LEN: "text",
  LEFT: "text, count",
  RIGHT: "text, count",
  MID: "text, start, count",
  CONCATENATE: "text1, text2, …",
  PMT: "rate, periods, present_value",
  TODAY: "",
  NOW: "",
};

const REF_TOKEN = /(\$?)([A-Za-z]{1,2})(\$?)(\d{1,3})/g;

// F4: cycles the reference at the caret through A1 → $A$1 → A$1 → $A1.
// Returns the new text and where that reference now ends, or null when the
// caret isn't on a reference.
export function cycleAbsolute(value: string, caret: number): { value: string; caret: number } | null {
  if (!isFormula(value)) return null;
  for (const match of value.matchAll(REF_TOKEN)) {
    const start = match.index ?? 0;
    const end = start + match[0].length;
    if (caret < start || caret > end) continue;
    const before = value[start - 1] ?? "";
    const after = value[end] ?? "";
    if (/[A-Za-z0-9_.]/.test(before) || /[A-Za-z0-9_(]/.test(after)) continue;
    const [, colAbs, col, rowAbs, row] = match;
    const next =
      !colAbs && !rowAbs ? `$${col}$${row}` : colAbs && rowAbs ? `${col}$${row}` : !colAbs && rowAbs ? `$${col}${row}` : `${col}${row}`;
    return { value: value.slice(0, start) + next + value.slice(end), caret: start + next.length };
  }
  return null;
}
