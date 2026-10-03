# PAPI

A small macOS menu-bar app with two tabs, always one shortcut away
(default **⌥'**):

- **Calculator** — a Numi-style notepad: type natural-language math and
  see live results next to each line. Variables, `prev`, `sum`/`average`/
  `min`/`max`, percentages (`20% of 80`, `rent increased by 5%`), unit
  conversions (`5 lb to kg`), currencies (`1 usd to chf`), durations and
  dates (`next friday`, `today + 14 days`).
- **Spreadsheet** — a compact 25×7 grid with formulas (powered by
  HyperFormula), copy/paste, fill-down, undo/redo, bold/italic and fills.

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
