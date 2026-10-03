# Design tokens — dark theme

## Why this exists

Both tabs need to look like one app, and the calculator tab is being
built next. Defining the palette as tokens once, and retrofitting the
spreadsheet tab to use them in Phase 8, means the calculator tab in
Phases 9-14 is built against the real palette from the start instead of
getting themed twice.

This defines a single dark theme (matching the Numi reference screenshot)
— not a light/dark toggle. If a light mode is ever wanted, it's a second
value set behind a `data-theme` attribute; out of scope for now.

## Tokens

Approximate starting values, picked to match the reference screenshot's
feel — treat as a first pass, adjust freely once it's rendering:

```css
:root {
  --bg-primary: #1e1e1e;      /* app background */
  --bg-elevated: #262626;     /* toolbar, formula bar, panels */
  --border: #3a3a3a;

  --text-primary: #ececea;    /* main numbers / input text */
  --text-secondary: #8a8a88;  /* muted chrome, placeholders */
  --text-accent: #5b9bd5;     /* keywords / variables, e.g. "sum" */
  --text-result: #a8d24c;     /* computed values, Numi's green */
  --text-error: #e0645a;      /* parse errors, circular refs */

  --selection-bg: #2f4a63;    /* selected cell / active line */

  --font-mono:
    ui-monospace, "SF Mono", Menlo, Consolas, monospace;
}
```

The monospace stack is a deliberate choice, not a default — a
number-heavy UI like this reads more evenly with tabular figures than
with a proportional font.

## Where these apply

- Spreadsheet tab: grid background, cell borders, selection highlight,
  toolbar background, formula bar
- Calculator tab (once built): line background, result coloring by kind
  (plain arithmetic vs. unit conversion vs. currency vs. `sum` — see
  CALC_SPEC.md's "Styling" section for which token maps to which)
