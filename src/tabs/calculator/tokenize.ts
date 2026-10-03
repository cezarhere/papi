export type TokenType =
  | "number"
  | "identifier"
  | "operator"
  | "lparen"
  | "rparen"
  | "colon"
  | "equals"
  | "percent"
  | "unknown";

export interface Token {
  type: TokenType;
  value: string;
}

// One token per match; whitespace is simply skipped (not matched by any
// alternative). Order matters: number and identifier must come before
// the catch-all so e.g. ".5" and "kg" aren't split into stray characters.
// Hyphens are allowed inside identifiers (not just as the operator) so a
// made-up unit like CALC_SPEC.md's "bogus-unit" example still tokenizes
// as one identifier rather than three tokens. Trailing digits are also
// allowed (not just letters/hyphens) so area units like "m2" tokenize as
// one identifier instead of splitting into "m" + the number 2 — the
// number alternative is tried first, so a leading digit like "2kg"
// still splits into a number token followed by an identifier token.
const TOKEN_PATTERN =
  /\d+(?:\.\d+)?|\.\d+|[a-zA-Z][a-zA-Z0-9-]*|[+\-*/^]|[()]|:|=|%|\S/g;

export function tokenize(raw: string): Token[] {
  const matches = raw.match(TOKEN_PATTERN) ?? [];
  return matches.map((value) => ({ type: classify(value), value }));
}

function classify(value: string): TokenType {
  if (/^(?:\d+(?:\.\d+)?|\.\d+)$/.test(value)) return "number";
  if (/^[a-zA-Z][a-zA-Z0-9-]*$/.test(value)) return "identifier";
  if (value === "(") return "lparen";
  if (value === ")") return "rparen";
  if (value === ":") return "colon";
  if (value === "=") return "equals";
  if (value === "%") return "percent";
  if (value === "+" || value === "-" || value === "*" || value === "/" || value === "^") {
    return "operator";
  }
  return "unknown";
}
