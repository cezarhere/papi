# Phases 8-15 — append to your existing PROMPTS.md

Same rule as before: one phase per session, review and commit before the
next. Phase 15 is deliberately last — see its note below.

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

## Phase 15 — Background app: shortcut, no dock icon, tray

This is the point where the app stops being browser-only. Do this after
14, not before — it's a contained addition once the React app itself is
done, and Electron's dev loop is slower than Vite's, so there's no
upside to switching earlier.

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
