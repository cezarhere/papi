import { add, evaluate, mathUnit, type Unit } from "./math";
import { classifyLine, type DurationTerm, type LineShape } from "./classifyLine";
import { getCurrencyRates } from "./currencyRates";
import { tokenize } from "./tokenize";
import { isSupportedUnitToken } from "./units";
import type { CalculatorLine, LineKind } from "./types";

interface LineEvaluation {
  result: string | null;
  kind: LineKind;
  // Raw numeric value backing `result`, used by block aggregation below.
  // Not part of CalculatorLine — dropped before a line is returned.
  numericValue: number | null;
}

// Threaded through evaluateLines below. `blockValues` resets on every
// blank line (CALC_SPEC.md "Blocks are blank-line-delimited"); `names`
// and `prev` don't — they're document-scoped (CALC_SPEC.md "Variable/
// label scope is document-wide, not block-scoped").
export interface Environment {
  names: Map<string, number>;
  blockValues: number[];
  prev: number | null;
  // Max decimal places for formatNumber (Phase G "precision" setting) —
  // not formatCurrency, which stays fixed at 2 regardless.
  precision: number;
}

function createEnvironment(precision: number): Environment {
  return { names: new Map(), blockValues: [], prev: null, precision };
}

// mathjs's evaluate(expr, scope) takes a plain object, not a Map. `prev`
// is injected only when it exists, so referencing it before any line has
// produced a number throws "undefined symbol" (caught the same as any
// other unresolved reference) rather than evaluating to null.
//
// sum/average/min/max are also injected here (computed fresh from the
// current block, same values the bare keyword itself would show) so
// they're usable inside a larger expression, e.g. "sum - 100" once
// `sum` alone is 500. They're added *after* spreading names, so — like
// prev — they're reserved: a variable someone names "sum" is shadowed
// by the block aggregate rather than the other way around. For an
// empty block, average is NaN and min/max are +/-Infinity (same as the
// bare keyword's own Error case); referencing them here flows through
// mathjs and trips the same isFinite check in evaluateArithmeticExpression,
// so e.g. "average - 1" on an empty block also lands on Error, not text.
function buildScope(env: Environment): Record<string, number> {
  const scope = Object.fromEntries(env.names);
  if (env.prev !== null) scope.prev = env.prev;

  const sum = env.blockValues.reduce((total, value) => total + value, 0);
  scope.sum = sum;
  scope.average = sum / env.blockValues.length;
  scope.min = Math.min(...env.blockValues);
  scope.max = Math.max(...env.blockValues);

  return scope;
}

function formatNumber(value: number, precision: number): string {
  return value.toLocaleString("en-US", { maximumFractionDigits: precision });
}

function formatCurrency(value: number): string {
  return value.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function evaluateArithmeticExpression(expression: string, env: Environment): LineEvaluation {
  let value: unknown;
  try {
    value = evaluate(expression, buildScope(env));
  } catch {
    return { result: null, kind: "text", numericValue: null };
  }

  // mathjs has built-in number+unit literal syntax (evaluate("1km")
  // succeeds and returns a Unit object, not a throw) — that's not a wrong
  // computation, just an incomplete one, almost always the start of a
  // conversion the user hasn't finished typing "... to <unit>" for yet.
  // Same soft treatment as a thrown/incomplete expression above, not a
  // hard error — only a value that parses as an actual number gets the
  // finite check below.
  if (typeof value !== "number") {
    return { result: null, kind: "text", numericValue: null };
  }

  if (!Number.isFinite(value)) {
    return { result: "Error", kind: "error", numericValue: null };
  }

  return { result: formatNumber(value, env.precision), kind: "arithmetic", numericValue: value };
}

// `name = value` / `Label: value` (CALC_SPEC.md "Labels and variables
// are unified"). A thrown expression (RHS doesn't parse at all — the
// normal state while still mid-typing it, e.g. "x = 1 +") is soft text,
// same as plain arithmetic's own catch below: the UI layer (Line.tsx's
// held-result display) papers over this by keeping the previous result
// on screen rather than flashing blank/error on every keystroke. A
// *successfully parsed* RHS that computes to a non-finite value (e.g.
// "x = 1/0") is a real, complete, wrong result, so that case still
// reports "Error" immediately — same convention as an invalid unit
// conversion.
function evaluateAssignment(name: string, expression: string, env: Environment): LineEvaluation {
  let value: unknown;
  try {
    value = evaluate(expression, buildScope(env));
  } catch {
    return { result: null, kind: "text", numericValue: null };
  }

  if (typeof value !== "number" || !Number.isFinite(value)) {
    return { result: "Error", kind: "error", numericValue: null };
  }

  env.names.set(name, value);
  return { result: formatNumber(value, env.precision), kind: "variable", numericValue: value };
}

function evaluateUnitConversion(
  amount: string,
  fromUnit: string,
  toUnit: string,
  precision: number,
): LineEvaluation {
  // classifyLine's matchConversion only checks that from/to are
  // identifier-shaped tokens, not that they're actually recognized units
  // — so "1 km to c" (typed on the way to "1 km to cm") reaches here just
  // as readily as a genuinely complete line. Whichever side isn't a real
  // unit *yet* is soft/undecided, not a hard error — same treatment as
  // "1km" alone getting the soft path in evaluateArithmeticExpression.
  if (!isSupportedUnitToken(fromUnit) || !isSupportedUnitToken(toUnit)) {
    return { result: null, kind: "text", numericValue: null };
  }
  try {
    // Built via the object API (mathUnit + .to()), not evaluate() on a
    // constructed string — mathjs's expression parser resolves bare
    // identifiers against its own function/constant namespace first,
    // and "min" (minutes) collides with mathjs's own min() function,
    // silently breaking any conversion built as a string. The object
    // API takes the unit as a plain string, sidestepping that lookup
    // entirely (discovered testing duration arithmetic below).
    const converted = mathUnit(Number(amount), fromUnit).to(toUnit);
    const numeric = converted.toNumber(toUnit);
    if (!Number.isFinite(numeric)) throw new Error("non-finite result");
    // Unit results aren't plain numbers, so they don't feed `sum` —
    // mixing bare numbers with unit-tagged results would be misleading.
    return { result: `${formatNumber(numeric, precision)} ${toUnit}`, kind: "unit", numericValue: null };
  } catch {
    return { result: "Error", kind: "error", numericValue: null };
  }
}

// Free-form time-unit arithmetic (CALC_SPEC.md "v2 scope", e.g.
// "2h + 35min"). `displayUnit` is either an explicit trailing "to
// <unit>" or defaults to the first term's unit. Built term-by-term via
// the object API (mathUnit + add()), same reason as evaluateUnitConversion
// above — a string like "2 h + 35 min" handed to evaluate() breaks on
// the "min" identifier collision.
function evaluateDuration(terms: DurationTerm[], displayUnit: string, precision: number): LineEvaluation {
  try {
    let total: Unit | null = null;
    for (const term of terms) {
      const amount = Number(term.amount) * (term.sign === "-" ? -1 : 1);
      const termUnit = mathUnit(amount, term.unit);
      total = total === null ? termUnit : add(total, termUnit);
    }
    if (total === null) throw new Error("no terms");

    const numeric = total.toNumber(displayUnit);
    if (!Number.isFinite(numeric)) throw new Error("non-finite result");
    return { result: `${formatNumber(numeric, precision)} ${displayUnit}`, kind: "unit", numericValue: null };
  } catch {
    return { result: "Error", kind: "error", numericValue: null };
  }
}

function evaluateCurrencyConversion(
  amount: string,
  fromCode: string,
  toCode: string,
): LineEvaluation {
  const rates = getCurrencyRates();
  const from = rates[fromCode];
  const to = rates[toCode];
  // Currency codes are always exactly 3 letters (ISO 4217) — a missing
  // side shorter than that is still being typed (e.g. "US" on the way to
  // "USD"), soft/undecided same as an incomplete unit. A full 3+ letter
  // code that's still not found is a genuine unknown/typo'd code, a real
  // error.
  if ((!from && fromCode.length < 3) || (!to && toCode.length < 3)) {
    return { result: null, kind: "text", numericValue: null };
  }
  if (!from || !to) {
    return { result: "Error", kind: "error", numericValue: null };
  }

  const converted = (Number(amount) / from.rate) * to.rate;
  if (!Number.isFinite(converted)) {
    return { result: "Error", kind: "error", numericValue: null };
  }

  // Like units, currency results don't feed `sum` — a mix of currencies
  // (or currency mixed with bare numbers) has no single numeric total.
  return { result: `${to.symbol}${formatCurrency(converted)}`, kind: "currency", numericValue: null };
}

function evaluateConversion(amount: string, from: string, to: string, precision: number): LineEvaluation {
  if (isSupportedUnitToken(from) || isSupportedUnitToken(to)) {
    return evaluateUnitConversion(amount, from, to, precision);
  }

  const fromCurrency = from.toUpperCase();
  const toCurrency = to.toUpperCase();
  const rates = getCurrencyRates();
  if (fromCurrency in rates || toCurrency in rates) {
    return evaluateCurrencyConversion(amount, fromCurrency, toCurrency);
  }

  // Neither side is a recognized unit or currency — plain text, same as
  // if the conversion shape had never matched (a conversion-shaped raw
  // string always contains letters, so it could never pass as
  // arithmetic anyway).
  return { result: null, kind: "text", numericValue: null };
}

// value/base (from classifyLine's percent-of/percent-change) is raw
// token text — a numeric literal, a variable name, or "prev" — resolved
// through the same scope `x = ...`'s RHS uses, so a name introduced
// earlier or `prev` works here exactly like it does anywhere else. An
// unresolved name (not yet defined, or a plain typo) throws, same as
// referencing it in arithmetic — treated as soft "text" rather than a
// hard error, since it's indistinguishable from a variable that just
// hasn't been assigned yet on an earlier line the user is still editing.
function resolveToken(token: string, env: Environment): number | null {
  try {
    const value = evaluate(token, buildScope(env));
    return typeof value === "number" ? value : null;
  } catch {
    return null;
  }
}

function evaluatePercentOf(percent: number, value: string, env: Environment): LineEvaluation {
  const base = resolveToken(value, env);
  if (base === null) {
    return { result: null, kind: "text", numericValue: null };
  }
  const result = (percent / 100) * base;
  if (!Number.isFinite(result)) {
    return { result: "Error", kind: "error", numericValue: null };
  }
  return { result: formatNumber(result, env.precision), kind: "arithmetic", numericValue: result };
}

function evaluatePercentChange(
  baseToken: string,
  percent: number,
  direction: "increase" | "decrease",
  env: Environment,
): LineEvaluation {
  const base = resolveToken(baseToken, env);
  if (base === null) {
    return { result: null, kind: "text", numericValue: null };
  }
  const delta = base * (percent / 100);
  const result = direction === "increase" ? base + delta : base - delta;
  if (!Number.isFinite(result)) {
    return { result: "Error", kind: "error", numericValue: null };
  }
  return { result: formatNumber(result, env.precision), kind: "arithmetic", numericValue: result };
}

// sum/average of an empty block are 0 (an empty sum, and 0/0 lands on
// NaN which the finite check below turns into an error — see below).
// min/max of an empty block have no meaningful value at all — Math.min/
// max() with no arguments return +/-Infinity, which the same finite
// check also turns into an error, with no extra special-casing needed.
function evaluateAggregate(keyword: string, blockValues: number[], precision: number): LineEvaluation {
  const sum = blockValues.reduce((total, value) => total + value, 0);

  let result: number;
  switch (keyword) {
    case "average":
      result = sum / blockValues.length;
      break;
    case "min":
      result = Math.min(...blockValues);
      break;
    case "max":
      result = Math.max(...blockValues);
      break;
    default:
      result = sum;
  }

  if (!Number.isFinite(result)) {
    return { result: "Error", kind: "error", numericValue: null };
  }
  return { result: formatNumber(result, precision), kind: "aggregate", numericValue: result };
}

// Dates/times don't feed `sum`/`prev` — same reasoning as units and
// currency, there's no single meaningful numeric total for a date.
function evaluateDateTime(date: Date, hasTime: boolean): LineEvaluation {
  const result = hasTime
    ? date.toLocaleString("en-US", {
        weekday: "short",
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })
    : date.toLocaleDateString("en-US", {
        weekday: "short",
        year: "numeric",
        month: "short",
        day: "numeric",
      });
  return { result, kind: hasTime ? "time" : "date", numericValue: null };
}

function evaluateShape(shape: LineShape, env: Environment): LineEvaluation {
  switch (shape.kind) {
    case "assignment":
      return evaluateAssignment(shape.name, shape.expression, env);
    case "aggregate":
      return evaluateAggregate(shape.keyword, env.blockValues, env.precision);
    case "conversion":
      return evaluateConversion(shape.amount, shape.from, shape.to, env.precision);
    case "duration":
      return evaluateDuration(shape.terms, shape.displayUnit, env.precision);
    case "percent-of":
      return evaluatePercentOf(shape.percent, shape.value, env);
    case "percent-change":
      return evaluatePercentChange(shape.base, shape.percent, shape.direction, env);
    case "datetime":
      return evaluateDateTime(shape.date, shape.hasTime);
    case "arithmetic":
      return evaluateArithmeticExpression(shape.expression, env);
    case "text":
      return { result: null, kind: "text", numericValue: null };
  }
}

// Blocks are blank-line-delimited (CALC_SPEC.md): a block is a run of
// consecutive non-empty lines, and `sum` only looks at numeric results
// within its own block. This walks the lines in order, tokenizing and
// classifying each one, then evaluating it against the shared
// environment, resetting the running block total on every blank line.
export function evaluateLines(lines: CalculatorLine[], precision: number): CalculatorLine[] {
  const env = createEnvironment(precision);

  return lines.map((line) => {
    const trimmed = line.raw.trim();

    let evaluation: LineEvaluation;
    if (trimmed === "") {
      env.blockValues = [];
      evaluation = { result: null, kind: "text", numericValue: null };
    } else {
      const tokens = tokenize(line.raw);
      const shape = classifyLine(tokens, line.raw);
      evaluation = evaluateShape(shape, env);
    }

    if (evaluation.numericValue !== null) {
      // Aggregate results (sum/average/min/max) don't re-feed blockValues
      // — otherwise a repeated or referenced aggregate keeps compounding
      // (a second "sum" would double-count the first one's own result,
      // and "sum - 100" would read a total that already included itself).
      // Repeating an aggregate should be idempotent, not escalate. `prev`
      // isn't affected — "sum" then "prev * 2" doubling the total is
      // still the expected behavior.
      if (evaluation.kind !== "aggregate") {
        env.blockValues = [...env.blockValues, evaluation.numericValue];
      }
      env.prev = evaluation.numericValue;
    }

    const { result, kind } = evaluation;
    return { ...line, result, kind };
  });
}
