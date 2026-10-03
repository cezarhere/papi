# PAPI

A small macOS menu-bar app with two tabs, always one shortcut away
(default **⌥'**):

- **Calculator** — a Numi-style notepad: type natural-language math on
  each line and see live results next to it.
  - Arithmetic: `+ - * / ^`, parentheses, `mod`, and functions such as
    `sqrt`, `abs`, `round`, `floor`, `ceil`, `log`, `exp`, `sin`/`cos`/`tan`,
    `factorial`; constants `pi`, `e`.
  - Variables and labels: `x = 5`, `Rent: 1200`, `item 2000`; `prev` is the
    last result.
  - Blocks (separated by a blank line): `sum`, `average`, `min`, `max`,
    usable alone or inside an expression (`sum - 100`).
  - Percentages: `20% of 80`, `100 increased by 20%`, `100 + 10%`, and with
    a variable or `prev` as the base (`rent increased by 5%`).
  - Units: mass, length, volume, time, temperature, data, area, speed
    (`5 lb to kg`, `60 mi/h to km/h`, `100 m2 to sqft`), and duration
    math (`2h + 35min`).
  - Currencies: `1 usd to chf` (USD, EUR, GBP, CHF, JPY; live daily rates).
  - Dates: `today`, `next friday`, `3 months ago`, `today + 14 days`.
  - Click a result to copy it. Drag the divider to resize the columns; long
    lines wrap. Precision (0–10 decimals) is a setting.
- **Spreadsheet** — a 50-row × 26-column (A–Z) grid with formulas (powered
  by HyperFormula: `SUM`, `AVERAGE`, `COUNT`, `MIN`, `MAX`, `IF` and many
  more), cell references and ranges, formula-bar editing, copy/paste with
  relative references, fill-down, undo/redo, bold/italic and fill colors,
  and CSV import/export.
- **App** — lives in the menu bar, toggles with a global shortcut (default
  ⌥', changeable in Settings), optional launch at login, remembers your last
  tab, and opens on whichever Space you're on.

Everything is saved automatically on your Mac.

## Install

Download the latest `.dmg` from the
[Releases](../../releases) page, open it and drag PAPI to Applications.
Builds are signed and notarized by Apple. Apple Silicon and Intel are
both supported (macOS 12+).

## Privacy

PAPI has no accounts, analytics or telemetry. Your data stays in
`~/Library/Application Support/PAPI`. The only network request is a
once-a-day fetch of currency exchange rates from
[frankfurter.dev](https://frankfurter.dev) (no personal data sent);
offline, it falls back to bundled rates.

## Build from source

```
npm install
npm run electron:dev      # run in Electron with hot reload
npm run dev               # plain browser (no tray/shortcut features)
npm run typecheck && npm run typecheck:electron
npm run electron:package  # unsigned local .app in release/
npm run dist              # signed + notarized DMG (needs Apple credentials)
```

To regenerate the icon: `python3 build/make-icon.py` (needs Pillow).

## Releasing

Push a `v*` tag; `.github/workflows/release.yml` builds, signs,
notarizes and publishes to GitHub Releases. See the header of that file
for the required repository secrets.

## Docs

`SPEC.md`, `CALC_SPEC.md`, `DESIGN.md` and `TESTING.md` describe
requirements, design tokens and a manual test checklist.

## License

[GPL-3.0](LICENSE). PAPI uses HyperFormula under its GPLv3 license, which
requires derivative works to be GPL-compatible as well.

## Reporting bugs

Use **Report a Bug…** in the menu-bar icon's menu — it opens a GitHub issue
pre-filled with your PAPI and macOS version — or
[open an issue](../../issues/new/choose) directly. For calculator bugs,
include the exact lines you typed.
