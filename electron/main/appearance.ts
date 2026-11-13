import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { app, nativeTheme } from "electron";

// Settings → Appearance: follow the system, or force light or dark.
// Applied through nativeTheme.themeSource, which drives both the window's
// vibrancy material and the renderer's prefers-color-scheme, so the
// stylesheet needs no separate override. Stored in its own small file
// (like shortcut.json) because it must be applied before the window
// exists, to avoid a flash of the wrong appearance on launch.
export type Appearance = "system" | "light" | "dark";

export function isAppearance(value: unknown): value is Appearance {
  return value === "system" || value === "light" || value === "dark";
}

let current: Appearance = "system";

function appearancePath(): string {
  return join(app.getPath("userData"), "appearance.json");
}

export function loadAppearance(): void {
  try {
    if (existsSync(appearancePath())) {
      const parsed: unknown = JSON.parse(readFileSync(appearancePath(), "utf-8"));
      if (parsed && typeof parsed === "object" && "appearance" in parsed) {
        const { appearance } = parsed as { appearance: unknown };
        if (isAppearance(appearance)) current = appearance;
      }
    }
  } catch {
    // Unreadable file just means "system".
  }
  nativeTheme.themeSource = current;
}

export function getAppearance(): Appearance {
  return current;
}

export function setAppearance(value: Appearance): void {
  current = value;
  nativeTheme.themeSource = value;
  try {
    writeFileSync(appearancePath(), JSON.stringify({ appearance: value }));
  } catch (error) {
    console.error("Failed to persist appearance:", error);
  }
}
