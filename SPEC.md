# Spreadsheet tab — spec

This is the source of truth for what "done" looks like. Update it as
requirements change; keep CLAUDE.md and PROMPTS.md pointing at it rather
than duplicating details.

## Scope

A traditional spreadsheet tab, separate from the (not-yet-built) Numi-style
calculator tab. No natural-language parsing, no unit conversion — standard
spreadsheet behavior only.

## Grid sizing

- **Revised again for the public release:** the cap grew from 25 x 7 to
  50 rows x 26 columns (A–Z). Cells outside the grid are ignored when
  loading saved documents. CSV import/export was built and then removed:
  the app is for quick numbers and screenshots, not data interchange.
  Auto-growing rows/columns remains a possible future change.
- **Revised post-v1** (see CLAUDE.md/PROMPTS.md Phase 24): the grid always
  renders its full fixed size — **50 rows x 26 columns (A–Z)** — regardless of
  window size. The original v1 behavior (below) clamped the rendered
  row/col count to whatever fit the viewport, with no scrolling; that
  made the grid effectively shrink/"disappear" past its edges on a small
  window, which is exactly what this revision replaces.
- The grid container scrolls (both axes) to reach cells outside the
  visible viewport; row/column headers stay pinned (`position: sticky`)
  while scrolling. Keyboard navigation (arrow keys) scrolls the active
  cell into view automatically.
- Columns are lettered (A, B, C, ...), rows are numbered (1, 2, 3, ...),
  matching standard spreadsheet convention.

<details>
<summary>Original v1 behavior (superseded above)</summary>

- Grid fit the available window size on load and on manual window resize.
- Rows: auto-added as needed up to a cap of 25 rows. Once the cap was
  reached, no further rows were added automatically — only a manual
  window resize (to a size that would fit more) added more.
- Columns: same behavior, cap of 7 columns.

</details>

## Cell editing

- Click a cell to select it.
- Double-click, or start typing while selected, to enter edit mode.
- A formula bar above the grid shows the raw content of the selected cell
  (e.g. `=SUM(A1:A3)`) while the cell itself shows the computed value.
- Arrow keys move selection; Tab/Enter confirm and move right/down;
  Escape cancels an in-progress edit.

## Formulas

- Formulas start with `=`.
- Arithmetic: `+ - * / ^`, parentheses, standard precedence.
- Cell references: `A1` style.
- Ranges: `A1:A10` style.
- Functions (v1 set): `SUM`, `AVERAGE`, `COUNT`, `MIN`, `MAX`, `IF`.
- Circular references show an error in the cell rather than crashing or
  infinite-looping.

## Editing features

- **Undo/redo**: covers cell content changes. Formatting changes (below)
  should also be undoable — confirm this is wired up in Phase 6, since the
  formula engine's built-in undo/redo won't know about formatting on its
  own (see Architecture decisions).
- **Copy/paste**: standard cell/range copy and paste, including formulas
  (with relative reference adjustment, same as a normal spreadsheet).
- **Fill-down**: select a cell (or a value in a cell above a selected
  range) and fill down copies its content downward, adjusting relative
  references the same way a drag-fill does in Excel/Sheets.

  > Assumption to confirm: "fill down copies the cell down" is read as
  > standard drag-fill semantics (relative refs adjust). If you actually
  > want a literal copy with no reference adjustment, say so before
  > Phase 4 — it's a meaningfully different implementation.

## Formatting

- **Bold** toggle for selected cell(s).
- **Italic** toggle for selected cell(s).
- **Fill color**: 3 preset choices, applied to selected cell(s) background.
  Defaults below — change freely, they're placeholders:
  - Yellow `#FFF2AC`
  - Green `#C6E9C6`
  - Blue `#CFE3FA`

## Architecture decisions (already made — don't re-litigate these mid-build)

- **Formula engine: HyperFormula.** Handles parsing, the dependency graph,
  recalculation, circular-reference detection, and built-in undo/redo and
  clipboard support. Licensed GPLv3 for open-source use, which is fine
  since this project is being open-sourced.
- **Grid UI: fully custom React component, not a grid library.** The
  window-based auto-sizing behavior and the modest max grid (26 × 50 = 1,300
  cells, all rendered) don't benefit from a general-purpose grid/virtualization library,
  and a custom component gives full control over the formula bar,
  selection, and formatting UI this spec needs.
- **Formatting lives outside HyperFormula.** HyperFormula is a headless
  calculation engine — it has no concept of bold/italic/fill color. Store
  formatting in a separate structure keyed by cell address (e.g.
  `Record<string, { bold?: boolean; italic?: boolean; fill?: string }>`)
  that lives alongside the HyperFormula instance, and make sure both are
  saved together and both are covered by undo/redo.
- **Platform: browser-based (Vite + React + TS) for now, not Electron.**
  Keeps setup fast and dependency-light. Wrapping this in Electron later
  (e.g. with `electron-vite`) is a small, separate step if a desktop app
  is still wanted — it doesn't affect anything above.

## Persistence

- No manual Save/Load-to-file UI (removed post-v1, once the app became a
  personal-use Electron tray app — see CLAUDE.md/PROMPTS.md Phase 24):
  autosave to `localStorage` (CALC_SPEC.md "Autosave") is the only
  persistence path. The document format below is unchanged — it's just
  what autosave writes/reads, not a downloadable file anymore.

- **Format** (finalized in Phase 7):

  ```json
  {
    "version": 1,
    "cells": {
      "A1": "10",
      "B1": "=A1*2",
      "C3": "hello"
    },
    "formats": {
      "A1": { "bold": true, "fill": "#FFF2AC" },
      "C3": { "italic": true }
    }
  }
  ```

  - `version` — schema version, for future format migrations.
  - `cells` — sparse map keyed by `"A1"`-style address; empty cells are
    omitted. Values are always strings — the same raw text you'd see in
    the formula bar (formulas included, starting with `=`). HyperFormula's
    serialization API (`getSheetSerialized`/`setSheetContent`) returns and
    accepts content this way regardless of a cell's computed type, so
    numbers round-trip as numeric strings (`"10"`, not `10`) rather than
    native JSON numbers — this was confirmed empirically while
    implementing, not assumed up front.
  - `formats` — sparse map keyed the same way, values are the same
    `{bold?, italic?, fill?}` shape formatting is already stored in during
    a session — a direct dump/restore, no transformation.
  - No grid-dimensions field — the grid is a fixed size (see "Grid
    sizing"), so persisting it wouldn't mean anything on restore.

## Out of scope for v1 (revisit later if wanted)

- Multiple sheets/tabs within the spreadsheet tab itself.
- Number formatting (currency, percentages, decimals).
- More functions beyond the v1 set.
- Cross-tab references between Calculator and Spreadsheet tabs.
