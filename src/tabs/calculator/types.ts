export type LineKind =
  | "arithmetic"
  | "unit"
  | "currency"
  | "aggregate"
  | "variable"
  | "date"
  | "time"
  | "text"
  | "error";

export interface CalculatorLine {
  id: string;
  raw: string;
  result: string | null;
  kind: LineKind;
}
