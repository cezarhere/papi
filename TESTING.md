# Manual test reference

A checklist of example inputs covering every supported feature in both
tabs — paste these in after a change to sanity-check for regressions.
Not a substitute for reading `SPEC.md`/`CALC_SPEC.md` for exact rules,
just a fast way to re-exercise everything by hand.

## Calculator tab

### Arithmetic
```
2 + 3 * 4
(1 + 2) * 3
```

### Variables / labels
`name = value`, `Label: value`, or bare `label value` (space, no operator) — all three write into the same name → value environment.
```
x = 5
Rent: 1200
item 2000
x + 10
```

### `prev`
Resolves to the most recently computed numeric result.
```
100
prev * 2
```

### Aggregates
`sum`, `average`, `min`, `max` — block-scoped (reset by a blank line), usable bare or inline in an expression.
```
10
20
30
sum
average
sum - 5
```

### Unit conversion
Mass, length, volume, time, temperature, data storage, area, speed — dimensional check against mathjs's own unit system, so aliases like "kilometers" work too, not just exact symbols.
```
5 lb to kg
1 km to cm
1 floz to mL
1 oz to g
100 degF to degC
1 GB to MB
1 m2 to sqft
60 mi/h to km/h
```
Metric area units support the bare `N2` shorthand (`m2`, `cm2`, `mm2`,
`km2`) — that's a mathjs quirk, not this app's own rule. Imperial area
units don't have an `N2` shorthand at all (`ft2`/`in2`/`yd2`/`mi2` are
*not* valid units); use `sqft`/`sqin`/`sqyd`/`sqmi` instead.

### Duration arithmetic
Free-form addition across compatible time units; display unit defaults to the first term's.
```
2h + 35min
90min to h
```

### Percentages
```
20% of 30
100 increased by 20%
50 - 10%
```

### Currency
Live rates (fetched on launch, cached); static fallback covers USD/EUR/GBP/CHF/JPY if offline.
```
1 EUR to USD
100 USD to JPY
```

### Dates
```
today
tomorrow
next friday
3 months ago
today + 14 days
next wednesday + 2 weeks
```
`"next <weekday> in <N> <unit>"` (e.g. `next wednesday in 2 weeks`) is a
worked-around chrono-node bug — should resolve to the correct weekday,
not silently fall back to today + the duration. See `CALC_SPEC.md`
"Architecture decisions" if this regresses.

### Time
```
3pm PST
```

### Held-result / soft-error behavior
Not a single input to test, but worth eyeballing after evaluation-logic
changes: type these *one keystroke at a time* rather than pasting whole
— the result column should hold the last valid value (or stay blank)
through every intermediate keystroke, never flash red "Error" until the
line is genuinely complete-and-wrong.
```
x = 1 +        (→ should hold, not flash Error, until completed)
1km            (→ should stay blank, not error, until "to <unit>" is added)
1 km to c      (→ should stay blank, not error, until "cm" is finished)
```
Genuine errors (should still show immediately, no delay):
```
1/0
1 kg to L
x = 1/0
```

## Spreadsheet tab

### Arithmetic + references
```
A1: 10
B1: =A1*2
C1: =A1+B1
```

### Ranges + functions (v1 set: SUM, AVERAGE, COUNT, MIN, MAX, IF)
```
=SUM(A1:A3)
=AVERAGE(A1:A3)
=COUNT(A1:A3)
=MIN(A1:A3)
=MAX(A1:A3)
=IF(A1>5, "big", "small")
```

### Editing
- Double-click a cell, or type directly while it's selected, to edit
- Type in the formula bar — should stay in sync with the cell live
- Fill handle: select a cell/range, drag the bottom-right handle down
- Copy/paste: `Cmd+C` / `Cmd+V`, relative references should adjust
- Undo/redo: `Cmd+Z` / `Cmd+Shift+Z`
- `Cmd+A` should select the grid's cells, not the whole page
