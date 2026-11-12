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

### Typed values
```
1/2/2026      -> shown as a date (day/month order follows the system locale)
50%           -> 50%
$12.50  €5    -> currency
12:30         -> time
1,234.5       -> the number 1234.5
=TODAY()      -> a date, not a serial number
=IF(TRUE,1,2) -> 1 (bare TRUE/FALSE work)
=SUM(A1:A3    -> closing bracket added on Enter
=1/0          -> red #DIV/0!, hover for the explanation
123456789012345 in a narrow column -> ####
long text next to empty cells      -> spills across them
```

### Navigation and selection
- Arrows move; Shift+arrows extend; Cmd+arrows jump to the edge of a block
  of data (Cmd+Shift extends)
- Tab / Shift+Tab move right/left, Enter / Shift+Enter down/up; Enter after
  a run of Tabs returns to the column the run started in
- Home, Cmd+Home, Cmd+End, Page Up/Down
- Shift+click extends; click a column/row header (drag or Shift+click for
  several), the corner for everything; Cmd+A selects all
- Dragging a selection past the edge scrolls the grid
- Selected rows/columns are highlighted in the headers; the status bar
  shows Sum/Average/Count/Min/Max for a multi-cell selection (click to copy)

### Editing
- Type over a cell (arrows then commit and move), or double-click / F2 to
  edit in place (arrows move the caret); Escape cancels
- Type in the formula bar — stays in sync with the cell live
- Delete or Backspace clears the selection's content (formatting stays);
  Cmd+A then Delete empties the sheet, formatting included, and leaves A1
  selected — one Cmd+Z brings it all back
- Formulas: `=su` offers SUM… (Tab accepts, arrows choose); click or drag
  cells to insert a reference at the caret (also from the formula bar);
  clicking another cell right after a reference replaces it; right after
  an operator the arrow keys pick a cell; F4 cycles `A1 → $A$1 → A$1 → $A1`
- Each range a formula refers to is outlined in its own colour

### Clipboard, fill, undo
- Cmd+C / Cmd+X / Cmd+V: within the sheet formulas adjust and formatting
  comes along; a cut moves the cells; one cell pasted over a selection
  fills it; pasting near the edge never writes outside the grid
- Copy a block and paste it into Numbers/Excel/a text editor, and back
- Right-click a cell: Cut / Copy / Paste / Clear Contents (in the app)
- Fill handle: drag in any direction; `1, 2` continues as `3, 4`; formats
  are carried
- Undo/redo: `Cmd+Z` / `Cmd+Shift+Z` — covers content and formatting in
  the order they happened, and restores the selection
- Switch to the Calculator tab and back: selection, scroll position and
  undo history are still there

### Toolbar
- Σ with a block of numbers selected writes totals underneath; with one
  cell under a column of numbers it proposes `=SUM(…)` (Enter confirms);
  the chevron has Average / Count / Min / Max
- Sort ↑ / ↓ with one cell selected sorts the surrounding table by that
  column, keeping the header row and a `=SUM` totals row in place;
  formulas like `=B2*C2` still point at their own row afterwards
- Rows-and-columns menu (also on right-click): insert above/below/left/
  right, delete rows/columns; totals and formats follow; one Cmd+Z each
- Alignment menu: Left / Centre / Right / Automatic
- `$` `%` `,` toggle their format; `.0` / `.00` change decimals; `123`
  menu has the full list
- After using any toolbar control the arrow keys still move the selection

### App
- Appearance follows the system (light/dark, accent colour)
- Cmd+1 / Cmd+2 switch tabs; Cmd+, opens Settings
- Menu-bar icon: click toggles the window, right-click opens the menu
- Window size and position are remembered
- Settings → shortcut: Option- and Shift- combinations can be recorded
