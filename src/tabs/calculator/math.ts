import {
  absDependencies,
  acosDependencies,
  addDependencies,
  asinDependencies,
  atanDependencies,
  cbrtDependencies,
  ceilDependencies,
  cosDependencies,
  create,
  divideDependencies,
  evaluateDependencies,
  eDependencies,
  expDependencies,
  factorialDependencies,
  floorDependencies,
  log10Dependencies,
  log2Dependencies,
  logDependencies,
  maxDependencies,
  minDependencies,
  modDependencies,
  multiplyDependencies,
  piDependencies,
  powDependencies,
  roundDependencies,
  sinDependencies,
  sqrtDependencies,
  subtractDependencies,
  tanDependencies,
  toDependencies,
  unaryMinusDependencies,
  unaryPlusDependencies,
  unitDependencies,
  type Unit,
} from "mathjs";

// App-owned mathjs instance (instead of the shared default one the named
// "mathjs" exports use). mathjs's expression parser exposes functions that
// can mutate or extend the instance for the rest of the session (import,
// createUnit) or re-enter the parser (evaluate, parse, simplify,
// derivative). None are needed for a calculator line, and a pasted line
// like import({...}, {override: true}) could silently redefine built-ins.
// This is mathjs's documented hardening recipe: capture what our own code
// needs first, then replace the dangerous functions *in the expression
// scope only* — the captured references below keep working.
//
// Only the factories the calculator actually exposes are bundled
// (arithmetic, units + `to`, and a practical set of scalar functions)
// rather than mathjs's full `all` set — matrices, complex numbers,
// bignumbers, statistics, etc. were roughly two thirds of the bundle and
// are unreachable from a one-line calculator. Operator factories must be
// listed explicitly: the expression parser looks operators up by name at
// runtime, it doesn't pull them in as dependencies. To expose another
// function, add its `<name>Dependencies` here.
const instance = create({
  evaluateDependencies,
  addDependencies,
  subtractDependencies,
  multiplyDependencies,
  divideDependencies,
  powDependencies,
  modDependencies,
  unaryMinusDependencies,
  unaryPlusDependencies,
  unitDependencies,
  toDependencies,
  absDependencies,
  sqrtDependencies,
  cbrtDependencies,
  roundDependencies,
  floorDependencies,
  ceilDependencies,
  expDependencies,
  logDependencies,
  log10Dependencies,
  log2Dependencies,
  sinDependencies,
  cosDependencies,
  tanDependencies,
  asinDependencies,
  acosDependencies,
  atanDependencies,
  factorialDependencies,
  minDependencies,
  maxDependencies,
  piDependencies,
  eDependencies,
});

export const evaluate = instance.evaluate.bind(instance);
export const add = instance.add.bind(instance);
export const mathUnit = instance.unit.bind(instance);
export type { Unit };

const blocked = () => {
  throw new Error("Function is disabled");
};

instance.import(
  {
    import: blocked,
    createUnit: blocked,
    evaluate: blocked,
    parse: blocked,
    simplify: blocked,
    derivative: blocked,
  },
  { override: true },
);
