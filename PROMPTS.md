# Build plan — copy these into Claude Code one at a time

Run these in order, in separate sessions/messages. Review and commit after
each phase before starting the next — don't queue them all up at once.
Read `SPEC.md` first if you haven't (Claude Code will too, but you should
know what it's building toward).

---

## Phase 1 — Adaptive grid, no editing yet

```
Read CLAUDE.md and SPEC.md before starting.

Build the static grid for the spreadsheet tab (src/tabs/SpreadsheetTab.tsx
and whatever new files under src/tabs/spreadsheet/ make sense):

- Render a grid of cells, columns lettered A/B/C..., rows numbered 1/2/3...
- On mount and on window resize, compute how many rows/columns fit the
  visible area and render that many, capped at 25 rows and 7 columns per
  SPEC.md's "Grid sizing" section
- Click a cell to select it (single selection for now, highlight it visually)
- No editing, no formulas, no formatting yet — just the grid and selection

Propose your resize-detection approach (ResizeObserver vs window resize
listener) and cell sizing constants before writing code, then implement.
```

## Phase 2 — Cell editing + formula bar

```
Read SPEC.md's "Cell editing" section.

Add to the spreadsheet tab:
- Double-click a selected cell, or start typing while it's selected, to
  enter edit mode
- A formula bar above the grid showing the raw content of the selected
  cell; the cell itself always shows a value (for now, since formulas
  aren't wired up yet, just show raw text in both places)
- Arrow keys move selection; Tab/Enter confirm the edit and move
  right/down; Escape cancels an in-progress edit
- Cell contents are stored in React state for now (a Record<string, string>
  keyed by address like "A1" is fine) — this gets replaced by HyperFormula
  in the next phase, don't over-invest in this storage shape
```

## Phase 3 — Formula engine (HyperFormula)

```
Read SPEC.md's "Formulas" and "Architecture decisions" sections.

Wire up HyperFormula as the source of truth for cell values/formulas,
replacing the plain state from Phase 2:
- Cells starting with = are parsed as formulas
- Support +-*/^, parentheses, cell refs (A1), ranges (A1:A10), and
  SUM/AVERAGE/COUNT/MIN/MAX/IF
- The grid shows computed values; the formula bar shows the raw formula
  for the selected cell
- Changing a cell recalculates everything that depends on it
- Circular references show a visible error in the affected cell instead
  of crashing

Propose how you're wrapping the HyperFormula instance (a hook? a small
class?) before writing the integration, since this is the piece most of
the rest of the app will depend on.
```

## Phase 4 — Copy/paste + fill-down

```
Read SPEC.md's "Editing features" section, including the two "assumption
to confirm" notes on grid sizing and fill-down — confirm with me if either
seems wrong before building on them.

Add:
- Copy/paste for a single cell or a selected range, including formulas
  with relative reference adjustment
- Fill-down: select a range, filling down from the top cell copies its
  content downward with relative references adjusted, same as a normal
  spreadsheet drag-fill
```

## Phase 5 — Undo/redo

```
Wire up undo/redo for cell content and formula changes, using
HyperFormula's built-in undo/redo where it covers the operation.
Keep this phase scoped to content/formulas only — formatting undo/redo
is explicitly Phase 6's problem, not this one, since formatting lives
outside HyperFormula (see SPEC.md).
```

## Phase 6 — Formatting (bold, italic, fill color)

```
Read SPEC.md's "Formatting" and "Architecture decisions" sections.

Add a small toolbar with bold, italic, and 3 fill-color options
(defaults in SPEC.md, easy to change). Store formatting in a structure
separate from HyperFormula, keyed by cell address, applied to the
selected cell(s).

Extend the undo/redo from Phase 5 to also cover formatting changes —
this likely means undo/redo needs to operate over a combined
"content + formatting" history rather than relying on HyperFormula's
built-in undo alone. Propose your approach before implementing.
```

## Phase 7 — Persistence

```
Read SPEC.md's "Persistence" section.

Add save/load of the full spreadsheet state (cell values/formulas +
formatting) to a JSON file. Propose the exact JSON shape before
implementing, and update SPEC.md's "Persistence" section with the
finalized format once it's settled.
```

---

## Phase 8 — Design tokens / dark theme

```
Read DESIGN.md.

Replace hardcoded colors across the app (App.css, spreadsheet grid/cell/
toolbar/formula-bar components) with the CSS custom properties defined
in DESIGN.md. Apply the dark palette as the app's only theme for now —
no light/dark toggle needed yet, just replace the current light colors.

Also switch text to the monospace font stack in DESIGN.md, since it
reads better for a number-heavy UI.

Propose where the tokens should live (e.g. a new src/theme.css imported
once in main.tsx) before making the change, then do a single pass
replacing every hardcoded color you find — grep for hex codes and
rgb()/rgba() to make sure nothing's missed.
```

## Phase 9 — Calculator tab shell

```
Read CALC_SPEC.md's "Editing model" section.

Replace the CalculatorTab.tsx placeholder with a line-based editor:
- One line per row, each an editable text input
- Enter creates a new line below and moves focus to it
- Backspace on an empty line removes it and moves focus to the line above
- Up/Down arrows move focus between lines
- No evaluation yet — just line management and navigation
- Store lines per CALC_SPEC.md's "Line storage" note
```

## Phase 10 — Arithmetic evaluation

```
Read CALC_SPEC.md's "v1 scope" and "Architecture decisions" sections.

Wire up mathjs to evaluate each line's raw text as an arithmetic
expression (+ - * / ^, parentheses, plain numbers) and render the result
right-aligned, formatted with thousands separators. Lines that don't
parse as expressions should render with no result, not an error — plain
text lines are allowed.

Propose how you're structuring the mathjs wrapper (e.g. a
useLineEvaluator hook) before implementing.
```

## Phase 11 — Block-based aggregate (`sum`)

```
Read CALC_SPEC.md's "Blocks are blank-line-delimited" note.

Add support for a line containing just `sum`: it sums the numeric
results of all lines above it in the same block (consecutive non-empty
lines; a blank line ends the block). Style `sum` with --text-accent per
DESIGN.md, distinct from plain input text.
```

## Phase 12 — Unit conversion

```
Read CALC_SPEC.md's "v1 scope" unit conversion note.

Extend the line evaluator to recognize `<number> <unit> to <unit>`
syntax using mathjs's built-in unit system (e.g. `1kg to mg` ->
`1,000,000 mg`). Propose which unit categories to support in v1 (mass,
length, volume, time are reasonable defaults) before implementing.
```

## Phase 13 — Currency conversion

```
Read CALC_SPEC.md's "Currency" architecture decision.

Add a local JSON rate table (propose the shape and a starter currency
set — USD, EUR, GBP, CHF, JPY is a reasonable default, adjust freely)
and extend the line evaluator to recognize `<number> <CUR> to <CUR>`
syntax, rendering the result with the appropriate currency symbol.
```

## Phase 14 — Visual polish

```
Compare the calculator tab against the reference screenshot and
DESIGN.md's tokens. Adjust spacing, alignment, and result coloring
(plain results vs. unit/currency conversions vs. sum) so it reads
cleanly against the dark theme.
```

## Phase 15 — Parser architecture rework

```
Read CALC_SPEC.md's "Architecture decisions" section, specifically the
"Parser architecture" note.

Refactor evaluateLine.ts from the current regex-classifier chain into a
tokenize -> classify -> evaluate pipeline:
- A tokenizer that lexes a line into numbers, identifiers, operators,
  keywords (sum/average/min/max/prev/of/increased/decreased/to),
  colons, and equals signs
- A small ordered set of line-shape classifiers operating on the token
  stream (assignment/label, aggregate keyword, unit conversion,
  currency conversion, plain arithmetic) replacing the current
  standalone regexes
- A shared environment threaded through evaluateLines:
  `{ names: Map<string, number>, blockValues: number[], prev: number |
  null }`, replacing the current bare blockValues accumulator (names
  and prev aren't used yet — that's Phase 17 — but the environment
  shape should be ready for them)

This is a pure refactor: existing arithmetic, sum, unit conversion, and
currency conversion behavior must work identically afterward — re-run
the manual test cases from Phases 10-13 before moving on. No new
user-facing behavior in this phase.

Propose the token/line-shape types before implementing.
```

## Phase 16 — Percentages

```
Read CALC_SPEC.md's "v2 scope" percentage note.

Extend the line evaluator to recognize Numi's percentage phrasing:
- `<pct>% of <value>` (e.g. `20% of 30` -> `6`)
- `<value> increased by <pct>%` / `<value> decreased by <pct>%`
- bare `<value> + <pct>%` / `<value> - <pct>%` as shorthand for the same

Results are plain numbers (kind: arithmetic, --text-result), formatted
the same as other arithmetic results — no new color needed.
```

## Phase 17 — Labels, variables & prev

```
Read CALC_SPEC.md's "Labels and variables are unified", "Variable/label
scope", and "prev" architecture decisions.

Add two assignment syntaxes, both writing into the environment's
`names` map from Phase 15:
- `name = value` (variable syntax)
- `Label: value` (label syntax)

Either syntax's name becomes usable in later arithmetic expressions on
other lines (e.g. `rent = 1800` then `rent + food`). Names persist for
the whole document (survive blank lines) — this is intentionally
different from sum's block scoping, don't reuse the block-reset logic
for it.

Add `prev`: resolves to the most recently computed numeric result,
usable anywhere a number is (e.g. `1500 cm in inches` then `prev * 2`).

An assignment line's own value renders on the right like any other
result (kind: variable, --text-result). Per CALC_SPEC.md, the name/
operator portion of the input is not separately syntax-highlighted —
don't build per-token coloring for this phase.
```

## Phase 18 — Unit whitelist expansion + alias resolution

```
Read CALC_SPEC.md's "v2 scope" units note.

Add temperature, data storage, speed, and area as supported unit
categories, plus lb/oz to mass.

Also fix the alias gap: today, a conversion is only recognized if at
least one side is an exact token in the hardcoded SUPPORTED_UNITS set,
so a line with long-form aliases on both sides (e.g. "5 miles to
kilometers") silently falls through as plain text even though mathjs
itself understands both words fine. Replace the hardcoded whitelist
check with a query against mathjs's own unit system for category
membership. Propose the exact mathjs API before implementing.
```

## Phase 19 — average / min / max

```
Read CALC_SPEC.md's block-aggregate architecture decision.

Add `average`, `min`, and `max` as recognized aggregate keywords
alongside the existing `sum`, using the same block-scoped numeric
accumulator — which after Phase 17 also includes labels/variables in
the block, not just plain arithmetic lines.
```

## Phase 20 — Duration arithmetic

```
Read CALC_SPEC.md's "v2 scope" duration note.

Extend beyond the current `<number> <unit> to <unit>` conversion-only
shape to free-form arithmetic within the time category (e.g.
`2h + 35min`). Propose which display unit to render mixed-unit results
in before implementing.
```

## Phase 21 — Autosave / persistence

```
Read CALC_SPEC.md's "Autosave" architecture decision.

Add automatic persistence (browser storage, debounced — not on every
keystroke) for both tabs, so reopening the app restores the previous
calculator lines and spreadsheet content without manual action. This
is additive to the spreadsheet's existing manual Save/Load-to-JSON-file
feature, not a replacement for it. Propose the storage keys/shape and
debounce interval before implementing.
```

## Phase 22 — Dates & time

```
Read CALC_SPEC.md's "v2 scope" dates/time note.

Add support for:
- relative date keywords and math: today, tomorrow, next <weekday>,
  <N> weeks/months/days ago, <date> + <N> days
- clock time and basic timezone conversion (e.g. 3pm PST)

This is the first calculator feature needing a dependency beyond
mathjs (e.g. a natural-language date parser). Propose the library
before implementing.
```

## Phase 23 — Live currency rates

```
Read CALC_SPEC.md's updated "Currency" architecture decision.

Replace the static local rate table with a fetch-once-on-launch,
cached rate table, falling back to the bundled static table if the
fetch fails or the app is offline. Propose the exchange-rate API/
source, cache location, and refresh cadence before implementing.
```

## Phase 24 — Background app: shortcut, no dock icon, tray

This is the point where the app stops being browser-only. Do this after
14 and the v2 calculator phases (15-23), not before — it's a contained
addition once the React app itself is done, and Electron's dev loop is
slower than Vite's, so there's no upside to switching earlier.

```
This adds an Electron shell via electron-vite, wrapping the existing
React app unchanged:

- Register a global keyboard shortcut (propose a default, e.g.
  Cmd+Shift+Space, easy to override) that shows/hides the main window
- Hide the dock icon on macOS (app.dock.hide())
- Add a menu-bar tray icon with a Quit item — with no dock icon, this is
  the only way to fully quit the app, so it's not optional
- Closing the window should hide it, not quit the app; only the tray's
  Quit item exits
- Use Electron's single-instance lock so triggering the shortcut again,
  or a second launch, shows/focuses the existing window instead of
  opening a duplicate
- Hide the window automatically on blur (losing focus), matching
  Spotlight/Alfred/Raycast-style behavior — propose this before building
  it in case you'd rather it stay open until explicitly dismissed

Propose the file layout for the new electron/ directory (main process +
preload) before writing code.
```
