# CLAUDE.md

Context for Claude Code sessions on PAPI (this repo). Read this, `SPEC.md` (or
`CALC_SPEC.md` for calculator-tab work), `DESIGN.md`, and `PROMPTS.md`
before writing code.

## What this project is

A spreadsheet app with two tabs: a traditional spreadsheet (built, v1
complete per `SPEC.md`, Phases 1-7) and a Numi-style natural-language
calculator (v1 complete, Phases 8-14; v2 — Numi feature-parity work
identified via gap analysis, Phases 15-23 — complete). The React app
(both tabs) is done; Phase 24 wrapped it in an Electron shell so it
runs as a background/tray app rather than only in a browser tab.
Spreadsheet requirements: `SPEC.md`. Calculator requirements:
`CALC_SPEC.md`. Shared dark-theme design tokens for both tabs:
`DESIGN.md`. Phase-by-phase build plan with ready-to-use prompts:
`PROMPTS.md`.

## Stack

- Vite + React 18 + TypeScript (strict mode)
- `hyperformula` for formula parsing / dependency graph / recalculation
- `mathjs` + `chrono-node` for the calculator tab's expression/date
  parsing
- Electron (via `electron-vite`) wraps the React app for the background/
  tray-icon shell (`electron/` — main process + preload, kept separate
  from the browser-only `src/`); the plain-browser dev workflow (`npm
  run dev`) still works unchanged, Electron is additive
- No UI/grid library — the grid is a custom component
- No state management library yet — start with React state/context; only
  reach for something heavier if prop-drilling actually becomes a problem

## Commands

- `npm run dev` — start the plain-browser dev server (no Electron)
- `npm run typecheck` — type-check the React app (`src/`)
- `npm run typecheck:electron` — type-check the Electron main/preload
  code (`electron/`) — separate from the above, not run by `build`
- `npm run build` — production build of the React app
- `npm run electron:dev` — run the app in Electron, dev mode (hot reload)
- `npm run electron:build` — bundle main/preload/renderer into `out/`
- `npm run electron:preview` — build then launch the bundled Electron app

## Conventions

- Functional components + hooks only, no class components
- One component per file, colocated in `src/tabs/` for tab-level
  components and `src/tabs/spreadsheet/` for spreadsheet internals as it
  grows (create this folder when Phase 1 starts)
- Keep the HyperFormula instance and the formatting store as separate,
  clearly-named pieces of state — don't let formatting logic leak into
  the formula engine wrapper or vice versa (see SPEC.md → Architecture
  decisions)
- Prefer small, focused components over one large grid component —
  e.g. `Grid`, `Cell`, `FormulaBar`, `Toolbar` as separate files once
  there's enough code to justify the split
- No `any` — if HyperFormula's types are awkward, wrap them rather than
  loosening `strict`

## Working style for this repo

- This is being built phase by phase (see `PROMPTS.md`). Don't jump ahead
  to a later phase's functionality even if it seems easy to include —
  smaller reviewable diffs matter more than speed here.
- When a requirement in `SPEC.md` is marked "assumption to confirm," ask
  before building on top of it if the assumption seems load-bearing for
  what you're about to do.
- When there's a genuine design choice not already settled in SPEC.md
  (e.g. exact keyboard shortcuts, exact error message copy), propose the
  options briefly and pick a sensible default rather than blocking —
  note the choice in SPEC.md so it's not re-litigated later.
