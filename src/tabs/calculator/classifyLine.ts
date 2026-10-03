// English-only entry point: the default "chrono-node" export bundles every
// locale (de, fr, ja, ...) the app never uses.
import * as chrono from "chrono-node/en";
import { isTimeUnit } from "./units";
import type { Token } from "./tokenize";

export interface DurationTerm {
  sign: string;
  amount: string;
  unit: string;
}

export type LineShape =
  | { kind: "assignment"; name: string; expression: string }
  | { kind: "aggregate"; keyword: string }
  | { kind: "conversion"; amount: string; from: string; to: string }
  | { kind: "duration"; terms: DurationTerm[]; displayUnit: string }
  // value/base are the raw token text (a numeric literal, a variable
  // name, or "prev") rather than an already-parsed number — evaluateLine
  // resolves it through the same name/prev scope `x = ...` uses, so
  // "rent increased by 5%" and "5 increased by 5%" go through one path.
  | { kind: "percent-of"; percent: number; value: string }
  | {
      kind: "percent-change";
      base: string;
      percent: number;
      direction: "increase" | "decrease";
    }
  | { kind: "datetime"; date: Date; hasTime: boolean }
  | { kind: "arithmetic"; expression: string }
  | { kind: "text" };

// Exported so Line.tsx can style a recognized keyword (blue accent)
// independently of whether it successfully computed a result — an
// empty-block "average"/"min"/"max" is still a recognized keyword, it
// just has nothing to aggregate (see evaluateLine.ts).
export const AGGREGATE_KEYWORDS = new Set(["sum", "average", "min", "max"]);

// Order matters — first match wins, same dispatch order the old regex
// chain used.
export function classifyLine(tokens: Token[], raw: string): LineShape {
  const assignment = matchAssignment(tokens);
  if (assignment) return assignment;

  const aggregate = matchAggregateKeyword(tokens);
  if (aggregate) return aggregate;

  const conversion = matchConversion(tokens);
  if (conversion) return conversion;

  const compoundConversion = matchCompoundConversion(tokens);
  if (compoundConversion) return compoundConversion;

  const duration = matchDurationExpression(tokens);
  if (duration) return duration;

  const percentOf = matchPercentOf(tokens);
  if (percentOf) return percentOf;

  const percentChange = matchPercentChange(tokens);
  if (percentChange) return percentChange;

  const dateTime = matchDateTime(raw);
  if (dateTime) return dateTime;

  if (isExpressionCandidate(tokens)) {
    return { kind: "arithmetic", expression: raw.trim() };
  }

  return { kind: "text" };
}

// `name = value` or `Label: value` — both write into the same names
// environment (CALC_SPEC.md "Labels and variables are unified"). A
// bare "name:" or "name =" with nothing after falls through to "text"
// instead — there's no value to store yet.
function matchAssignment(tokens: Token[]): LineShape | null {
  // `label value` — a single label word directly followed by a number,
  // no operator between them at all (e.g. "item 2000"). Same "disregard
  // the label, keep the number" behavior as the colon form above, just
  // space-separated instead of requiring a `:`/`=`.
  if (tokens.length === 2) {
    const [nameToken, valueToken] = tokens;
    if (nameToken.type !== "identifier" || valueToken.type !== "number") return null;
    return { kind: "assignment", name: nameToken.value, expression: valueToken.value };
  }

  if (tokens.length < 3) return null;
  const [nameToken, opToken, ...rest] = tokens;
  if (nameToken.type !== "identifier") return null;
  if (opToken.type !== "equals" && opToken.type !== "colon") return null;

  return {
    kind: "assignment",
    name: nameToken.value,
    expression: rest.map((token) => token.value).join(" "),
  };
}

function matchAggregateKeyword(tokens: Token[]): LineShape | null {
  if (tokens.length !== 1) return null;
  const [token] = tokens;
  if (token.type !== "identifier" || !AGGREGATE_KEYWORDS.has(token.value)) {
    return null;
  }
  return { kind: "aggregate", keyword: token.value };
}

// `<number> <unit/currency> to <unit/currency>`, with an optional
// leading minus sign on the amount.
function matchConversion(tokens: Token[]): LineShape | null {
  let index = 0;
  let sign = "";
  if (tokens[index]?.type === "operator" && tokens[index].value === "-") {
    sign = "-";
    index += 1;
  }

  const amount = tokens[index];
  const from = tokens[index + 1];
  const toKeyword = tokens[index + 2];
  const target = tokens[index + 3];

  if (tokens.length !== index + 4) return null;
  if (amount?.type !== "number") return null;
  if (from?.type !== "identifier") return null;
  if (toKeyword?.type !== "identifier" || toKeyword.value !== "to") return null;
  if (target?.type !== "identifier") return null;

  return {
    kind: "conversion",
    amount: `${sign}${amount.value}`,
    from: from.value,
    to: target.value,
  };
}

// `<number> <unit>/<unit> to <unit>/<unit>` — speed has no standalone
// mathjs symbol (CALC_SPEC.md "v2 scope"), only compound expressions
// like "km/h", so this is a separate shape from the single-word
// conversion above rather than a generalization of it.
function matchCompoundConversion(tokens: Token[]): LineShape | null {
  let index = 0;
  let sign = "";
  if (tokens[index]?.type === "operator" && tokens[index].value === "-") {
    sign = "-";
    index += 1;
  }

  const amount = tokens[index];
  const fromNumerator = tokens[index + 1];
  const fromSlash = tokens[index + 2];
  const fromDenominator = tokens[index + 3];
  const toKeyword = tokens[index + 4];
  const toNumerator = tokens[index + 5];
  const toSlash = tokens[index + 6];
  const toDenominator = tokens[index + 7];

  if (tokens.length !== index + 8) return null;
  if (amount?.type !== "number") return null;
  if (fromNumerator?.type !== "identifier") return null;
  if (fromSlash?.type !== "operator" || fromSlash.value !== "/") return null;
  if (fromDenominator?.type !== "identifier") return null;
  if (toKeyword?.type !== "identifier" || toKeyword.value !== "to") return null;
  if (toNumerator?.type !== "identifier") return null;
  if (toSlash?.type !== "operator" || toSlash.value !== "/") return null;
  if (toDenominator?.type !== "identifier") return null;

  return {
    kind: "conversion",
    amount: `${sign}${amount.value}`,
    from: `${fromNumerator.value}/${fromDenominator.value}`,
    to: `${toNumerator.value}/${toDenominator.value}`,
  };
}

// `<number> <unit> (+|- <number> <unit>)+ (to <unit>)?` — free-form
// time-unit arithmetic (CALC_SPEC.md "v2 scope"), e.g. "2h + 35min".
// Requires at least two terms, so a bare "2h" alone still falls through
// to plain text/arithmetic as before. Every unit involved (including an
// explicit trailing target) must be time-dimensioned — this is what
// stops "rent + food"-shaped variable arithmetic from being mistaken
// for a unit expression, since they share the same token shape.
function matchDurationExpression(tokens: Token[]): LineShape | null {
  let index = 0;

  let sign = "";
  if (tokens[index]?.type === "operator" && tokens[index].value === "-") {
    sign = "-";
    index += 1;
  }
  if (tokens[index]?.type !== "number") return null;
  const firstAmount = tokens[index].value;
  index += 1;
  if (tokens[index]?.type !== "identifier") return null;
  const firstUnit = tokens[index].value;
  index += 1;

  const terms: DurationTerm[] = [{ sign, amount: firstAmount, unit: firstUnit }];

  while (
    tokens[index]?.type === "operator" &&
    (tokens[index].value === "+" || tokens[index].value === "-")
  ) {
    const termSign = tokens[index].value;
    const amountToken = tokens[index + 1];
    const unitToken = tokens[index + 2];
    if (amountToken?.type !== "number" || unitToken?.type !== "identifier") break;
    terms.push({ sign: termSign, amount: amountToken.value, unit: unitToken.value });
    index += 3;
  }

  if (terms.length < 2) return null;

  let displayUnit = terms[0].unit;
  if (tokens[index]?.type === "identifier" && tokens[index].value === "to") {
    const targetToken = tokens[index + 1];
    if (targetToken?.type !== "identifier") return null;
    displayUnit = targetToken.value;
    index += 2;
  }

  if (index !== tokens.length) return null;
  if (![...terms.map((term) => term.unit), displayUnit].every(isTimeUnit)) return null;

  return { kind: "duration", terms, displayUnit };
}

// `<pct>% of <value>`, e.g. "20% of 30" -> 6, or "20% of rent"/"20% of
// prev" -> resolved through the name/prev scope at evaluation time.
function matchPercentOf(tokens: Token[]): LineShape | null {
  if (tokens.length !== 4) return null;
  const [percentToken, signToken, ofToken, valueToken] = tokens;
  if (percentToken.type !== "number") return null;
  if (signToken.type !== "percent") return null;
  if (ofToken.type !== "identifier" || ofToken.value !== "of") return null;
  if (valueToken.type !== "number" && valueToken.type !== "identifier") return null;

  return {
    kind: "percent-of",
    percent: Number(percentToken.value),
    value: valueToken.value,
  };
}

// `<value> increased/decreased by <pct>%`, plus the bare shorthand
// `<value> +/- <pct>%` for the same. `<value>` is a numeric literal, a
// variable name introduced earlier (`x = ...`/`Label: ...`), or `prev`
// — same single-token scope as everywhere else a name resolves.
function matchPercentChange(tokens: Token[]): LineShape | null {
  if (tokens.length === 5) {
    const [base, verb, by, percent, sign] = tokens;
    const direction =
      verb.type === "identifier" && verb.value === "increased"
        ? "increase"
        : verb.type === "identifier" && verb.value === "decreased"
          ? "decrease"
          : null;
    if (
      (base.type === "number" || base.type === "identifier") &&
      direction !== null &&
      by.type === "identifier" &&
      by.value === "by" &&
      percent.type === "number" &&
      sign.type === "percent"
    ) {
      return {
        kind: "percent-change",
        base: base.value,
        percent: Number(percent.value),
        direction,
      };
    }
  }

  if (tokens.length === 4) {
    const [base, op, percent, sign] = tokens;
    const direction =
      op.type === "operator" && op.value === "+"
        ? "increase"
        : op.type === "operator" && op.value === "-"
          ? "decrease"
          : null;
    if (
      (base.type === "number" || base.type === "identifier") &&
      direction !== null &&
      percent.type === "number" &&
      sign.type === "percent"
    ) {
      return {
        kind: "percent-change",
        base: base.value,
        percent: Number(percent.value),
        direction,
      };
    }
  }

  return null;
}

// Relative dates/times (CALC_SPEC.md "v2 scope"): "today", "tomorrow",
// "next friday", "3 months ago", "today + 14 days", "3pm PST". Works on
// the raw text via chrono-node rather than tokens — natural-language
// date phrases don't decompose into this file's token shapes the way
// arithmetic/conversions do. A match must span the *entire* line, not
// a substring, so a chance date-like word inside unrelated text (or a
// line another shape should own, like duration arithmetic) doesn't get
// misclassified — verified none of this app's other syntax (arithmetic,
// assignments, conversions, percentages) parses as a date at all.
// Works around a chrono-node parsing bug (confirmed against chrono-node
// directly, isolated from this app's own code, on the latest published
// version — 2.10.1): "next/this/last <weekday> in <N> <unit>" (e.g.
// "next wednesday in 2 weeks") either silently drops the weekday and
// computes the duration from *today* instead (day/week units), or drops
// the duration entirely and returns the bare weekday date (month/year
// units) — wrong either way. The equivalent "+" phrasing ("next
// wednesday + 2 weeks") parses correctly in every case tested, so this
// rewrites the "in" form to "+" before handing it to chrono, rather than
// trusting chrono's own grammar for this specific compound pattern.
const RELATIVE_WEEKDAY_IN_DURATION =
  /^((?:next|this|last)\s+\S+)\s+in\s+(\d+\s+(?:day|days|week|weeks|month|months|year|years))$/i;

function matchDateTime(raw: string): LineShape | null {
  const trimmed = raw.trim();
  if (trimmed === "") return null;

  const durationRewrite = trimmed.match(RELATIVE_WEEKDAY_IN_DURATION);
  const parseTarget = durationRewrite ? `${durationRewrite[1]} + ${durationRewrite[2]}` : trimmed;

  const results = chrono.parse(parseTarget, new Date());
  if (results.length !== 1) return null;
  const [result] = results;
  if (result.text.trim() !== parseTarget) return null;

  return {
    kind: "datetime",
    date: result.start.date(),
    hasTime: result.start.isCertain("hour"),
  };
}

// Identifiers are allowed here (not just number/operator/paren) so
// expressions can reference names/prev, e.g. "rent + food" or
// "prev * 2". An identifier that isn't a defined name still resolves
// safely to plain text — mathjs throws on the undefined symbol at
// evaluation time, caught the same way a syntax error would be.
function isExpressionCandidate(tokens: Token[]): boolean {
  return (
    tokens.length > 0 &&
    tokens.every(
      (token) =>
        token.type === "number" ||
        token.type === "operator" ||
        token.type === "lparen" ||
        token.type === "rparen" ||
        token.type === "identifier",
    )
  );
}
