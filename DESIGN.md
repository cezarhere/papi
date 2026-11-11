# Design

## Direction

PAPI should feel like something that ships with macOS: system font, system
accent colour, light and dark appearance, translucent chrome, hairline
separators, native menus. The one deliberate exception is the calculator
tab's lines, which keep a monospace face (the Numi-style notepad reads
best with fixed-width digits).

This replaced the original single dark theme in v0.1.5.

## Tokens

Defined once in `src/theme.css`, in two value sets chosen by
`prefers-color-scheme` (Electron follows the system appearance):

| Token | Use |
| --- | --- |
| `--accent` | Selection, focus, active controls. In the app it is replaced at runtime with the accent colour from System Settings (`useSystemAppearance.ts`); the stylesheet value is the fallback for the plain-browser dev workflow. |
| `--bg-content` | The working surface: grid, calculator lines. Opaque. |
| `--bg-chrome` | Title bar, toolbar, status bar. Translucent in the app, over the window's vibrancy material; opaque in a browser and with Reduce Transparency. |
| `--bg-header` | Grid row/column headers. |
| `--bg-raised` | Popovers, the selected segment. |
| `--separator`, `--grid-line` | Hairlines between chrome areas; grid lines. |
| `--text-primary/secondary/tertiary` | Text, in decreasing emphasis. |
| `--text-result`, `--text-error` | Computed values; errors. |
| `--control-fill/hover/active` | Resting, hovered and pressed fills of controls. |
| `--accent-tint`, `--accent-soft`, `--focus-ring` | Derived from the accent: selection tint, pressed/on state, focus halo. |
| `--font-ui`, `--font-mono` | System font for everything; monospace for calculator lines. Numbers in the grid use the UI font with tabular figures. |

Older names (`--bg-primary`, `--bg-elevated`, `--border`, `--text-accent`,
`--selection-bg`) remain as aliases.

## Conventions

- Controls are 22–24px tall with a 5px radius; popovers 8–10px. No
  outlined buttons: a control is a soft fill or nothing until hovered.
- Separators are 0.5px (one device pixel on Retina).
- Buttons use the default arrow cursor, never a pointing hand.
- Focus is a 3px soft accent ring on controls; content text fields show
  only a caret.
- Booleans in Settings are switches.
- Motion is short (≤150ms) and switched off under Reduce Motion.
- Scrollbars are the system's own (overlay or always-on, per System
  Settings) — not hidden, not restyled.
- Fill colours are light pastels in both appearances; text on a filled
  cell is always dark.
