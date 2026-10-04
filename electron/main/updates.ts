import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { app, type BrowserWindow } from "electron";

// electron-updater is CommonJS with lazily-defined exports; loading it via
// require (typed with a type-only import) is the reliable way to use it from
// this ESM main bundle.
type Updater = typeof import("electron-updater").autoUpdater;

// Update prompts are shown *inside* PAPI's own window (a banner, see
// src/UpdateBanner.tsx), not as native dialogs. A menu-bar-only app is never
// "active", and testing showed native dialogs from it either land several
// windows behind everything else or, when attached to a window that isn't
// visible yet, resolve instantly with their default button (which downloaded
// an update the user hadn't agreed to). The banner is always visible, and
// every state change brings the window forward on the current Space first.
export type UpdateState =
  | { status: "available"; version: string }
  | { status: "downloading"; version: string; percent: number }
  | { status: "ready"; version: string }
  | { status: "none" }
  | { status: "error" };

let present: () => BrowserWindow | null = () => null;
let getWindow: () => BrowserWindow | null = () => null;

// bringForward: show PAPI's window on the current Space first. Progress
// ticks pass false (dozens of them, and the window is already up by then).
function emit(state: UpdateState, bringForward = true): void {
  const window = bringForward ? present() : null;
  (window ?? getWindow())?.webContents.send("update:state", state);
}

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
// the only time "you're up to date" / error messages are shown. Background
// checks stay silent unless an update is actually ready.
let manualCheck = false;
// Last version we already asked about during this session.
let promptedVersion: string | null = null;
let pendingVersion = "";
let lastPercent = -1;

function getUpdater(): Updater | null {
  // Unpackaged (dev) runs have no app-update.yml to read.
  if (!app.isPackaged) return null;
  if (updater) return updater;

  const instance = createRequire(import.meta.url)("electron-updater").autoUpdater as Updater;
  // Ask first: download only after the user clicks Download on the banner.
  instance.autoDownload = false;
  instance.autoInstallOnAppQuit = true;
  instance.allowPrerelease = false;

  instance.on("update-available", (info) => {
    // Background checks ask once per version per session (not every 6 hours
    // for the same release); a manual "Check for Updates…" always asks.
    if (!manualCheck && info.version === promptedVersion) return;
    promptedVersion = info.version;
    manualCheck = false;
    pendingVersion = info.version;
    emit({ status: "available", version: info.version });
  });
  instance.on("update-not-available", () => {
    if (manualCheck) emit({ status: "none" });
    manualCheck = false;
  });
  instance.on("download-progress", (progress) => {
    const percent = Math.round(progress.percent);
    if (percent === lastPercent) return;
    lastPercent = percent;
    emit({ status: "downloading", version: pendingVersion, percent }, false);
  });
  instance.on("update-downloaded", (info) => {
    manualCheck = false;
    emit({ status: "ready", version: info.version });
  });
  instance.on("error", (error) => {
    console.error("Update check failed:", error);
    if (manualCheck) emit({ status: "error" });
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
export function startUpdateChecks(
  getWindowToPresent: () => BrowserWindow | null,
  getExistingWindow: () => BrowserWindow | null,
): void {
  present = getWindowToPresent;
  getWindow = getExistingWindow;
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
    emit({ status: "error" });
    return;
  }
  manualCheck = true;
  void runCheck();
}

// Called from the banner's buttons (via IPC in index.ts).
export function downloadUpdateNow(): void {
  const instance = getUpdater();
  if (!instance) return;
  lastPercent = -1;
  emit({ status: "downloading", version: pendingVersion, percent: 0 }, false);
  instance.downloadUpdate().catch((error: unknown) => {
    console.error("Update download failed:", error);
    emit({ status: "error" });
  });
}

export function installUpdateNow(): void {
  getUpdater()?.quitAndInstall();
}
