# Calculator tab — spec

Numi-style natural-language calculator: a list of editable text lines,
each evaluated live, with the result shown right-aligned next to the
input. This replaces the CalculatorTab.tsx placeholder.

## Behavior (from the reference screenshot)

- Each line is plain editable text; its result renders right-aligned as
  you type
- Numbers format with thousands separators (`2200` on the left shows
  `2,200` on the right)
- A line containing just `sum` sums the numeric results of all lines
  above it in the current block
- A blank line ends a block — `sum` (and future aggregates) only look
  within their own block, not across blank-line boundaries
- Unit conversion: `<number> <unit> to <unit>` (e.g. `1kg to mg`) shows
  the converted value + unit on the right
- Currency conversion: `<number> <CUR> to <CUR>` (e.g. `1 EUR to USD`)
  shows a symbol-prefixed result on the right

## v1 scope

- Arithmetic: `+ - * / ^`, parentheses
- Aggregate keyword: `sum` only for v1
- Unit conversion: mass, length, volume, time — whatever mathjs's unit
  system covers out of the box
- Currency conversion: a small fixed local rate table (see Architecture
  decisions) — starter set USD, EUR, GBP, CHF, JPY, adjust to what you
  actually use
- No variable assignment (`x = 5`) in v1 — see v2 scope below

v1 is Phases 8-14, already built.

## v2 scope

Grown out of a Numi feature-gap review (see "Numi feature parity" below
for what was deliberately left out). Phases 15-23.

- **Percentages**, matching Numi's exact phrasing: `<pct>% of <value>`,
  `<value> increased/decreased by <pct>%`, and bare `<value> +/- <pct>%`
  as shorthand for the same
- **Labels and variables**, unified into one feature (see Architecture
  decisions) — `name = value` and `Label: value` both write into the
  same name → value environment, referenceable in later expressions
- **`prev`** — resolves to the most recently computed numeric result
- **`average`, `min`, `max`** aggregate keywords, alongside `sum`, same
  block model, now also picking up labels/variables in the block, not
  just plain arithmetic lines
- **Expanded unit categories**: temperature, data storage, speed, area;
  `lb`/`oz` added to mass (a gap in the original v1 whitelist). Unit
  recognition moved from a hand-maintained name whitelist to a
  dimensional check against mathjs's own unit system (see Architecture
  decisions), so aliases like "kilometers" work automatically. Speed has
  no standalone mathjs symbol — only compound expressions like `km/h` —
  so `<number> <unit>/<unit> to <unit>/<unit>` is its own shape rather
  than reusing the single-word conversion pattern
- **Duration arithmetic**: free-form addition across compatible time
  units (`2h + 35min`), not just the `<number> <unit> to <unit>` shape.
  Display unit defaults to the *first term's* unit (`2h + 35min` shows
  hours, `35min + 2h` shows minutes) unless an explicit trailing
  `to <unit>` overrides it — predictable, and matches how mathjs's own
  unit addition resolves anyway. Requires at least two terms; a bare
  `2h` alone stays plain text/arithmetic as before, and every unit
  involved must be time-dimensioned so `rent + food`-style variable
  arithmetic isn't mistaken for a unit expression (same token shape,
  disambiguated by the dimensional check from the units.ts module
  introduced this phase — see Architecture decisions)
- **Dates**: relative date keywords and math (`today`, `tomorrow`,
  `next friday`, `3 months ago`, `today + 14 days`), via chrono-node
  (Phase 22) — the first calculator dependency beyond mathjs. Parsed
  against the raw line text, not tokens; natural-language date phrases
  don't decompose into this app's token shapes the way arithmetic and
  conversions do. A match must span the entire line (not a substring)
  to count, and every other line shape is tried first, so date parsing
  can't misclassify e.g. `2h + 35min` (chrono partially matches
  "+ 35min" in isolation, but duration arithmetic already owns that
  shape by the time date matching would even run)
- **Time**: clock time and basic timezone conversion (`3pm PST`) — also
  chrono-node, which resolves the stated zone's offset (including
  DST-aware US abbreviations) into an absolute instant; "conversion"
  here means chrono resolves *from* the stated zone and the result
  displays in the reader's own local time, not an explicit `to <zone>`
  syntax between two arbitrary zones — chrono doesn't provide target-
  zone formatting, and the spec's only example is single-zone
- **Live currency rates**, replacing the static v1 table (see updated
  Architecture decision below)
- **Autosave**: both tabs persist automatically (see Architecture
  decision below) — not a calculator-only feature, but grouped here
  since it shipped alongside this batch of work

### Numi feature parity — explicitly out of scope

Deliberately not adopting these, at least for now:
- Full natural-language prose mixing calculations into sentences
- Comments (`"..."` inline, `//` full-line)
- Copy-result affordance
- Multiple independent notes/documents (single continuous line list
  stays for now)
- Number base conversion (hex/binary/octal), CSS/hex color conversion,
  cryptocurrency rates, headers (`# ...`)

## Architecture decisions

- **Expression engine: mathjs.** MIT licensed, has arithmetic and a real
  unit-conversion system built in already. There's no dependency-graph
  problem here like the spreadsheet had — this is line-by-line
  evaluation, so `mathjs.evaluate()` covers most of it directly without
  needing a HyperFormula-style engine.
- **Unit recognition (Phase 18): dimensional check, not a name
  whitelist.** v1 kept a hand-maintained `Set` of exact unit tokens
  (`kg`, `mi`, etc.), which missed long-form aliases mathjs itself
  understands fine (e.g. "kilometers") whenever *both* sides of a
  conversion used one, and required manually adding every new unit
  (the `lb`/`oz` gap). v2 instead tries `mathjs.unit(token)` and checks
  `.equalBase()` against one reference unit per supported category
  (`kg`, `m`, `L`, `s`, `degC`, `bytes`, `m2`, `m/s`) — any token
  mathjs can parse into one of those dimensions is supported, with no
  per-unit maintenance. Speed's reference is `m/s` since mathjs has no
  standalone speed symbol. This logic lives in `units.ts` (extracted
  from `evaluateLine.ts` in Phase 20), since `classifyLine.ts` also
  needs it — duration arithmetic (below) needs to know at
  *classification* time whether tokens are real time units, not just at
  evaluation time.
- **Unit conversion and duration arithmetic are built via mathjs's
  object API (`mathjs.unit()` + `.to()` + `add()`), not `evaluate()` on
  a constructed string (Phase 20 fix).** Discovered while testing
  duration arithmetic: mathjs's expression parser resolves a bare
  identifier against its own function/constant namespace before
  treating it as a unit, and `min` (minutes) collides with mathjs's own
  `min()` function — `evaluate("35 min to h")` throws rather than
  converting. This was a **latent bug since Phase 12**: every prior
  phase's `evaluateUnitConversion` built conversions as strings for
  `evaluate()`, so any conversion involving `min` on either side was
  silently broken the whole time, just never exercised by the manual
  test cases used to verify those phases. The object API takes the
  unit as a plain string argument, never as a parsed identifier, so it
  isn't subject to this collision. `evaluateArithmeticExpression` and
  `evaluateAssignment` are unaffected — they already pass an explicit
  scope to `evaluate()`, and a provided scope value correctly overrides
  mathjs's built-in namespace (verified: `evaluate("min + 3", {min:
  5})` → `8`).
- **Currency: static local rate table for v1, live rates for v2 (Phase
  23).** The app is meant to open instantly from a background shortcut
  (see the background-app phase) — a network call per keystroke would
  work against that, so this stays a fetch-once-on-launch-and-cache
  model, not a call per line evaluated. Falls back to the bundled
  static table if the fetch fails or the app is offline, so the app
  still works without a network connection, just with staler rates.
  Source: `api.frankfurter.app` (free, no API key, CORS-open, ECB
  reference rates, USD-based like the existing table). Cached in
  `localStorage` (`currency-rates-cache`: `{fetchedAt, rates}`), read
  synchronously at module load so a fresh cache is available from the
  first render, refreshed in the background if missing or older than
  24 hours. Lives in `currencyRates.ts`, which `evaluateLine.ts` reads
  via `getCurrencyRates()` (a mutable module-level value, not a static
  import) so a background refresh updates future evaluations; already-
  rendered lines don't retroactively re-evaluate against new rates
  until their next edit — an accepted limit of the fetch-once model.
- **Blocks are blank-line-delimited.** A block is a run of consecutive
  non-empty lines. Aggregates only see numeric results within their own
  block. This is unchanged in v2 — see the scoping decision below for
  how it interacts with the new document-wide name environment.
- **Line storage**: array of `{ id, raw, result, kind }`, where `kind`
  is one of `arithmetic | unit | currency | aggregate | variable | date
  | time | text | error` — mostly used to decide which color token to
  render the result in. `variable` covers both label (`Label: value`)
  and variable (`name = value`) assignment lines (see below);
  percentage results stay `arithmetic` since they're just numbers, no
  new color needed.
- **Parser architecture (Phase 15): tokenize → classify → evaluate,
  with a shared environment.** The v1 evaluator is a chain of
  standalone regexes (a conversion-shape pattern, then an
  arithmetic-character-whitelist gate), which was enough for arithmetic
  + one conversion shape + one keyword but doesn't compose for labels,
  variables, and percentages living on the same line grammar. v2 moves
  to: a tokenizer (numbers, identifiers, operators, keywords, `:`, `=`),
  an ordered set of line-shape classifiers over the token stream
  (assignment/label, aggregate keyword, unit conversion, currency
  conversion, plain arithmetic), and an environment object threaded
  through `evaluateLines` — `{ names: Map<string, number>, blockValues:
  number[], prev: number | null }` — replacing the old bare
  `blockValues` accumulator. This is a pure refactor in Phase 15: v1
  behavior must be unchanged afterward, and it's a prerequisite for
  Phase 17 (labels/variables), not additive on its own.
- **Labels and variables are unified.** `name = value` and
  `Label: value` both write into the same `names` map in the
  environment above — one system, two entry syntaxes. Either name is
  usable in later arithmetic expressions (`rent = 1800` then
  `rent + food`), and both are picked up by `sum`/`average`/`min`/`max`
  within their block, matching Numi's own documented behavior (its
  `sum` example uses `=` assignments, not `:` labels, and still totals
  them). The assignment line's computed value renders on the right like
  any other result; the name/operator portion of the line itself is
  *not* separately syntax-highlighted, since per-token coloring inside
  a plain `<input>` isn't supported by the current one-color-per-line
  architecture — revisit only if that's specifically wanted later.
- **Variable/label scope is document-wide, not block-scoped.** This is
  a deliberate asymmetry with aggregate scoping above: `sum` etc. only
  look within their own block, but a name defined with `=` or `:`
  stays resolvable for the rest of the document, surviving blank lines
  — this matches Numi's actual behavior, not the block-reset rule used
  for aggregates.
- **`prev`** resolves to the most recently computed numeric result,
  tracked as `prev` in the same environment, updated after every line
  that produces a number (arithmetic, aggregate, variable/label — not
  unit/currency/date/time results, which aren't plain numbers).
- **`sum`/`average`/`min`/`max` are usable inside a larger expression**,
  not just as a bare keyword — e.g. `sum - 100` once `sum` alone is
  500. They're injected into the same scope `buildScope` already builds
  for names/`prev`, added last so they're reserved (a variable named
  "sum" is shadowed by the block aggregate, same precedent as `prev`).
  This surfaced a real bug in the original block-accumulator design: a
  bare aggregate line's own result was feeding back into `blockValues`,
  so a second `sum` (or a `sum` referenced in a later expression) would
  double-count the first one, compounding rather than staying
  idempotent. Fixed by excluding `kind: "aggregate"` results from
  `blockValues` specifically — they still update `prev`, so `sum` then
  `prev * 2` still works, but repeating or referencing `sum` no longer
  escalates the total.
- **Autosave**: both tabs persist automatically (debounced, not on
  every keystroke) to browser storage, so reopening the app restores
  prior state with no manual action. (The spreadsheet tab originally
  also had a manual Save/Load-to-JSON-file feature alongside this: it
  was removed post-v1, once the app became a personal-use Electron tray
  app with no need for an explicit export/import flow — see
  CLAUDE.md/PROMPTS.md Phase 24. Autosave is now the only persistence
  path for either tab.)
- **Held result display, not instant blank/error, while a line is
  mid-typing.** Numi-parity fix: typing something that doesn't parse
  *yet* (e.g. `x = 1 +`, one keystroke before `x = 1 + 2`) used to
  either blank the result or — for assignments specifically — flash red
  "Error" on every intermediate keystroke. Now `Line.tsx`'s
  `useHeldResult` keeps showing the line's last real result for 400ms
  before letting a `null` evaluation clear it, so a normal typing pace
  never sees the flash; a fresh number or a genuine "Error" (a
  grammatically *complete* but wrong line — divide by zero, a bad
  currency code, `average` on an empty block) still commits instantly,
  no delay. This is purely a display-layer smoothing effect in
  `Line.tsx` — it doesn't touch `evaluateLine.ts`'s actual computed
  environment, which still correctly treats an in-progress line as
  having no value for `blockValues`/`prev`/name-lookup purposes.
  Required real evaluation-logic changes to make this safe, in two
  passes:
  - `evaluateAssignment`'s RHS-doesn't-parse-yet case (a thrown
    `evaluate()`, the normal state while still typing the RHS) reports
    soft `kind: "text"` instead of hard `kind: "error"`, matching the
    convention plain arithmetic already used — only a RHS that *parses*
    but computes to a non-finite value is still a real, immediate
    "Error".
  - **Follow-up bug found post-ship**: `evaluateArithmeticExpression`'s
    non-finite check assumed a successful, non-throwing `evaluate()`
    call always meant a real number — wrong, since mathjs has built-in
    number+unit literal syntax (`evaluate("1km")` *succeeds*, returning
    a `Unit` object, not a throw). That silently hard-errored on
    `1km` alone, mid-typing a conversion, with no exception to catch.
    Fixed by treating a non-`number` *successful* result the same as a
    thrown one. The same false assumption existed in `classifyLine.ts`'s
    `matchConversion`: it only checks that `from`/`to` are
    identifier-*shaped* tokens, not that they're actually recognized
    units/currencies — so `1 km to c` (typed on the way to `1 km to
    cm`) reaches `evaluateUnitConversion` just as readily as a genuinely
    complete line, and hard-errored the same way. Fixed by having
    `evaluateUnitConversion` soft-return whenever either side isn't yet
    `isSupportedUnitToken`, and `evaluateCurrencyConversion` soft-return
    whenever a missing code is under 3 letters (ISO 4217 codes are
    always exactly 3) — a *full* unrecognized code, or a recognized
    unit pair with genuinely incompatible dimensions (`1 kg to L`), are
    still immediate, real errors. Duration and percent-of/change didn't
    need this: `matchDurationExpression` already gates on `isTimeUnit`
    at classify time, and percent shapes' tokens are all numeric/keyword,
    not open-ended identifiers.
- **chrono-node workaround: `"next/this/last <weekday> in <N>
  <unit>"` is rewritten to the `"+"` form before parsing.** Confirmed by
  calling chrono-node directly, isolated from this app's own code, on
  the latest published version (2.10.1): chrono's own grammar mishandles
  this specific compound phrase two different ways — `"next wednesday in
  2 weeks"` silently drops the weekday and computes the duration from
  *today* instead (Sat, not the following Wednesday); `"next wednesday
  in 1 year"` drops the duration entirely and returns the bare weekday
  date. The equivalent `"+"` phrasing (`"next wednesday + 2 weeks"`)
  parses correctly in every case tested (all of day/week/month/year,
  all of next/this/last). `classifyLine.ts`'s `matchDateTime` detects the
  `RELATIVE_WEEKDAY_IN_DURATION` pattern and rewrites `" in "` to `" + "`
  before handing the string to `chrono.parse()`, rather than trusting
  chrono's grammar for this one compound shape. This is a workaround for
  a third-party bug, not a change to this app's own date logic — worth
  re-checking if chrono-node ships a fix upstream.

## Editing model

Different from the spreadsheet's cell-grid navigation — this is closer
to a plain text editor:

- One line per row
- Enter creates a new line below and moves focus to it
- Backspace on an empty line removes it and moves focus to the line above
- Up/Down arrows move focus between lines
- The focused line's raw text is what's editable; there's no separate
  formula-bar-vs-cell split like the spreadsheet — Numi shows raw input
  directly
- Multi-line selection: Shift+Click or Shift+Up/Down extends a
  contiguous selection from an anchor line; a plain click or arrow
  collapses it back to one line. Cmd/Ctrl+A selects every line.
  Selected lines get the `--selection-bg` highlight (same token the
  spreadsheet grid uses). Backspace/Delete on a multi-line selection
  removes every selected line (deleting everything leaves one fresh
  empty line, same invariant as the last-line case below); typing a
  character over a multi-line selection replaces it the same way a text
  field replaces selected text — one line with just what was typed — no
  other bulk copy/move actions on the selection yet.

## Styling

Use DESIGN.md's tokens:

- `--text-primary` — line input text
- `--text-accent` — recognized keywords (`sum`, and in v2:
  `average`/`min`/`max`/`prev`)
- `--text-result` — computed values (plain arithmetic, unit, currency)
- `--text-error` — lines that fail to parse where a result was expected
  (e.g. `1kg to bogus-unit`)
