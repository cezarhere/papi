import { mathUnit, type Unit } from "./math";

// v2 unit categories (CALC_SPEC.md "v2 scope"): mass, length, volume,
// time, temperature, data storage, area, speed. Rather than a hand-
// maintained name whitelist (v1's approach, which missed long-form
// aliases like "kilometers" and gaps like lb/oz), membership is checked
// dimensionally: a token counts as supported if mathjs can parse it as
// a unit and its base dimension matches one of these references. Speed
// has no standalone mathjs symbol (only compound "km/h"-style
// expressions), hence "m/s" here instead of a single word.
const CATEGORY_REFERENCE_UNITS: Unit[] = [
  "kg", // mass
  "m", // length
  "L", // volume
  "s", // time
  "degC", // temperature
  "bytes", // data storage
  "m2", // area
  "m/s", // speed
].map((name) => mathUnit(name));

const TIME_REFERENCE_UNIT = mathUnit("s");

function parseUnit(token: string): Unit | null {
  try {
    return mathUnit(token);
  } catch {
    return null;
  }
}

export function isSupportedUnitToken(token: string): boolean {
  const candidate = parseUnit(token);
  if (!candidate) return false;
  return CATEGORY_REFERENCE_UNITS.some((reference) => candidate.equalBase(reference));
}

// Narrower than isSupportedUnitToken — used to gate duration arithmetic
// (CALC_SPEC.md "v2 scope") to genuine time units, so e.g. "rent + food"
// isn't mistaken for a unit expression just because it has the same
// <number> <identifier> operator <number> <identifier> token shape.
export function isTimeUnit(token: string): boolean {
  const candidate = parseUnit(token);
  if (!candidate) return false;
  return candidate.equalBase(TIME_REFERENCE_UNIT);
}
