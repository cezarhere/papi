import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { app, dialog } from "electron";

// electron-updater is CommonJS with lazily-defined exports; loading it via
// require (typed with a type-only import) is the reliable way to use it from
// this ESM main bundle.
type Updater = typeof import("electron-updater").autoUpdater;

const FIRST_CHECK_DELAY_MS = 20_000;
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

// "Check for updates automatically" — on by default, opt-out in Settings.
// Stored in its own small file in the data folder (the main process needs
// it before any window exists, so it can't live in the renderer's
// localStorage).
function settingsPath(): string {
  return join(app.getPath("userData"), "settings.json");
}

let autoCheckEnabled = true;

export function loadUpdateSettings(): void {
  try {
    if (!existsSync(settingsPath())) return;
    const parsed: unknown = JSON.parse(readFileSync(settingsPath(), "utf-8"));
    if (parsed && typeof parsed === "object" && "checkForUpdates" in parsed) {
      const { checkForUpdates } = parsed as { checkForUpdates: unknown };
      if (typeof checkForUpdates === "boolean") autoCheckEnabled = checkForUpdates;
    }
  } catch {
    // Unreadable settings just mean defaults.
  }
}

export function getAutoCheckEnabled(): boolean {
  return autoCheckEnabled;
}

export function setAutoCheckEnabled(value: boolean): void {
  autoCheckEnabled = value;
  try {
    writeFileSync(settingsPath(), JSON.stringify({ checkForUpdates: value }));
  } catch (error) {
    console.error("Failed to persist update setting:", error);
  }
}

let updater: Updater | null = null;
// True only while the user explicitly chose "Check for Updates…" — that's
// the only time "you're up to date" / error dialogs are shown. Background
// checks stay silent unless an update is actually ready.
let manualCheck = false;

function getUpdater(): Updater | null {
  // Unpackaged (dev) runs have no app-update.yml to read.
  if (!app.isPackaged) return null;
  if (updater) return updater;

  const instance = createRequire(import.meta.url)("electron-updater").autoUpdater as Updater;
  instance.autoDownload = true;
  instance.autoInstallOnAppQuit = true;
  instance.allowPrerelease = false;

  instance.on("update-available", (info) => {
    if (manualCheck) {
      void dialog.showMessageBox({
        type: "info",
        message: `PAPI ${info.version} is available`,
        detail: "It's downloading in the background. You'll be asked to restart when it's ready.",
      });
    }
  });
  instance.on("update-not-available", () => {
    if (manualCheck) {
      void dialog.showMessageBox({
        type: "info",
        message: "You're up to date",
        detail: `PAPI ${app.getVersion()} is the latest version.`,
      });
    }
    manualCheck = false;
  });
  instance.on("update-downloaded", (info) => {
    manualCheck = false;
    void dialog
      .showMessageBox({
        type: "info",
        message: `PAPI ${info.version} is ready`,
        detail: "Restart PAPI to finish updating.",
        buttons: ["Restart now", "Later"],
        defaultId: 0,
        cancelId: 1,
      })
      .then(({ response }) => {
        if (response === 0) instance.quitAndInstall();
      });
  });
  instance.on("error", (error) => {
    console.error("Update check failed:", error);
    if (manualCheck) {
      void dialog.showMessageBox({
        type: "warning",
        message: "Couldn't check for updates",
        detail: "Check your internet connection and try again later.",
      });
    }
    manualCheck = false;
  });
  updater = instance;
  return updater;
}

async function runCheck(): Promise<void> {
  const instance = getUpdater();
  if (!instance) return;
  try {
    await instance.checkForUpdates();
  } catch {
    // Already reported through the "error" event; never let a failed check
    // surface as an unhandled rejection in the main process.
  }
}

// Called once at startup. The setting is re-read on every tick, so turning
// it off in Settings takes effect without a restart.
export function startUpdateChecks(): void {
  loadUpdateSettings();
  const tick = () => {
    if (autoCheckEnabled) void runCheck();
  };
  setTimeout(tick, FIRST_CHECK_DELAY_MS);
  setInterval(tick, CHECK_INTERVAL_MS);
}

// Menu: "Check for Updates…" — works even when automatic checks are off.
export function checkForUpdatesNow(): void {
  if (!getUpdater()) {
    void dialog.showMessageBox({
      type: "info",
      message: "Updates are only available in the installed app",
    });
    return;
  }
  manualCheck = true;
  void runCheck();
}
