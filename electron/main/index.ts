import { cpSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { app, BrowserWindow, globalShortcut, ipcMain, Menu, nativeImage, shell, Tray } from "electron";
import { release } from "node:os";
import { checkForUpdatesNow, getAutoCheckEnabled, setAutoCheckEnabled, startUpdateChecks } from "./updates";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Pin the user-data folder explicitly rather than letting Electron derive
// it from package.json's "name" — that name changed (spreadsheet-app ->
// papi) and a derived path silently orphans saved data on rename. Must run
// before app "ready" (and before any renderer touches localStorage, which
// lives inside this folder). One-time copy, never a move: the old folder
// is left in place as a backup.
// Display name (menu items like "Quit PAPI", About). Electron otherwise
// takes package.json's lowercase "name". The data folder is pinned
// explicitly below, so this doesn't move any saved data.
app.setName("PAPI");

const LEGACY_USER_DATA_NAME = "spreadsheet-app";
const USER_DATA_NAME = "PAPI";
// Only the app's own data is migrated (localStorage + the shortcut file) —
// not Chromium's lock/socket files or caches, which can throw mid-copy when
// the old build is still running. Copied into a temp folder and renamed on
// success, so a failed or interrupted copy leaves no half-populated target
// that a later launch would mistake for "already migrated".
const MIGRATED_ENTRIES = ["Local Storage", "shortcut.json"];
function pinUserDataPath(): void {
  const appData = app.getPath("appData");
  const target = join(appData, USER_DATA_NAME);
  const legacy = join(appData, LEGACY_USER_DATA_NAME);
  const staging = `${target}.migrating`;
  try {
    if (!existsSync(target) && existsSync(legacy)) {
      rmSync(staging, { recursive: true, force: true });
      mkdirSync(staging, { recursive: true });
      for (const entry of MIGRATED_ENTRIES) {
        const from = join(legacy, entry);
        if (existsSync(from)) cpSync(from, join(staging, entry), { recursive: true });
      }
      renameSync(staging, target);
    }
  } catch (error) {
    // A failed copy shouldn't block launch — worst case is a fresh start
    // (and the next launch retries, since target was never created).
    console.error("User-data migration failed:", error);
    rmSync(staging, { recursive: true, force: true });
  }
  app.setPath("userData", target);
}
pinUserDataPath();

// Replace cezarhere with the GitHub account/org that hosts the repo (also in
// package.json's homepage/repository).
const REPO_URL = "https://github.com/cezarhere/papi";

// Opens a pre-filled problem report (version + macOS already filled in) in
// the user's browser. Nothing is sent from the app itself: the user reviews and
// submits it on github.com, so no diagnostics leave the machine without
// their say-so. Only our own https URL is ever passed to openExternal.
function reportBug(): void {
  const body = [
    "**What happened?**",
    "",
    "**What did you expect to happen?**",
    "",
    "**How can we make it happen again?**",
    "1. ",
    "",
    "---",
    `PAPI ${app.getVersion()} · macOS (Darwin ${release()}) · ${process.arch}`,
  ].join("\n");
  const url = `${REPO_URL}/issues/new?labels=bug&body=${encodeURIComponent(body)}`;
  void shell.openExternal(url);
}

const DEFAULT_SHORTCUT = "Option+'";
// Persisted separately from the shortcut itself is not possible via
// localStorage — the main process needs to know it *before* any renderer
// exists, at app.whenReady() time, so this is a small JSON file in
// Electron's own per-app data directory instead (settings popover's
// "custom shortcut" recorder, Phase G).
let currentShortcut = DEFAULT_SHORTCUT;

function shortcutConfigPath(): string {
  return join(app.getPath("userData"), "shortcut.json");
}

function loadPersistedShortcut(): string {
  try {
    const path = shortcutConfigPath();
    if (!existsSync(path)) return DEFAULT_SHORTCUT;
    const parsed: unknown = JSON.parse(readFileSync(path, "utf-8"));
    if (parsed && typeof parsed === "object" && "accelerator" in parsed) {
      const { accelerator } = parsed as { accelerator: unknown };
      if (typeof accelerator === "string" && accelerator.length > 0) return accelerator;
    }
    return DEFAULT_SHORTCUT;
  } catch {
    // Corrupted/unreadable config is no worse than a fresh install —
    // fall back rather than crashing the app over a preference file.
    return DEFAULT_SHORTCUT;
  }
}

function savePersistedShortcut(accelerator: string): void {
  try {
    writeFileSync(shortcutConfigPath(), JSON.stringify({ accelerator }));
  } catch (error) {
    // Read-only or full disk: the shortcut still works for this session,
    // it just won't persist — not worth throwing inside an IPC handler.
    console.error("Failed to persist shortcut:", error);
  }
}

// Renderer input is untrusted as far as the main process is concerned —
// validate shape before acting on it. Accelerators are short strings like
// "Command+Shift+K"; anything else is rejected rather than registered.
const ACCELERATOR_PATTERN = /^[A-Za-z0-9+'`\-=,./;\[\]\\ ]{1,40}$/;

function isTrustedSender(event: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent): boolean {
  return mainWindow !== null && event.sender === mainWindow.webContents;
}

// Unregisters whatever's currently bound and tries the new accelerator.
// Only updates currentShortcut (and persists) on success — on failure the
// old one is left registered and still works, so the app never ends up
// with no working shortcut at all.
function applyShortcut(accelerator: string): boolean {
  globalShortcut.unregister(currentShortcut);
  const registered = globalShortcut.register(accelerator, toggleWindow);
  if (registered) {
    currentShortcut = accelerator;
    savePersistedShortcut(accelerator);
    return true;
  }
  // Re-claim the old one so unregister() above didn't leave the app with
  // nothing bound.
  globalShortcut.register(currentShortcut, toggleWindow);
  return false;
}

// A 44x44 (@2x of the standard 22x22 menu bar size) black rounded box with
// the percent sign knocked out, on a transparent background, inline rather than a separate asset
// file — no icon-path resolution to get wrong across dev/build. Marked
// as a template image below so macOS re-colors it (and inverts for dark
// menu bars) automatically — that's also why it's plain black, not the
// maroon/cream app-icon colors: template images ignore color entirely.
const TRAY_ICON_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAACwAAAAsCAYAAAAehFoBAAAEKklEQVR4nO2ZTahVVRTHf+deLZU+TEsrSgQDUVDrkQRCSIQI0sRo9sAGOXJmgyZJ5KDIDxAaWEQZQoJB2CxqJo2KEAUFQQwK1NKkBn70eveee2TDf8Vic7495zlxweacuz/W+u+11l5r7XPhPvVLyRytKaOMHmgAzOsBrNE8yaikOgCGQOp+PywBXdAYuFEiqxHgxJlsLfAm8ArwLPBAjfVlZG4wAi4BJ4GjwNlIbm1KnIn2AjNi0GebBfZJbtJEGYlME+iYmE2kjVTvXbZUvCeS9Y3kD+uCNrDvi8F/jlmfbSJZ4f1QhKWQzA1Wa9fjCrBdb2QiueH9hTzQcSix3zsVCbICs5hr2Ni4xiHJNK8sCnhZu3L6ChecEiAD4lvq3md60Hiq5wWn3VzQ1vkQcLUAQOoOxhbgOWAK2APcKlkzAS4DO4Cvczaet+kQn5cL06AM8BLg7xzhJuBAgXVelpA0WjfS8w3NW+b68ixiff8q5lcCfiwHsIE95+avAz4Cpp3p9kQgx3oGrRq9HY2VAX6mLWAD8IHmPAlccUKmxXSd07A9/wCe0Lq1AmIxuDHgWgWHo+taExg9JaaBXpKgG9pcIsCJTvtfijpfAAuiCNOa6mj4iOYEocfV9zuwXhvZrD5LAF86/u9GvLI+XcJM+A+wQvOGCu7hEBmdcO7wG7BY/VOqFaoSUWeA/cE7A6yK1s4H9mt8Vs+tGnsQOF1x0GoDblLXDsRsgxLLt8B5hcFtOnAjgT8M/KB17wHPC2xXdXQtDedlOt9mXYYKySfQJleNjfW01ipKtNnxwAH3m03UH+qQm8Ai4HPNTwtkTZpGqrYmSqK1Zu6DwI/q+xBY49wk3Ca+k/VC/3bg0TagPYg6LhE3O0hnFe4CvRq5yX6B9rRKBzh2s86iRJG/mW9u1PpHgF9dpjvhZCxTKLRUvkKh0me+XgFbEgi3E6PPouSxWQLXK8lkSjpmjSMRr94Amyv84sz9WiR8BlipsY/Vd1vPFwVkdxPArZxdDAfy0bckbCnwqcYsYszXd4ww92etXaiC6JLAPd4SQyMNm3bfceu/isZMY6HkRH47rZI0JBmjc9HBa+wSRQV8fIpHro54PQJp81JVcKG4z6MDFVGiVgEfTHitQsOpK8x36PpjAPM2d0uantK1aouuWVnJmptVVyQDnahYKbqENm2T6PdMRZq3vosuOf1fO8fIh5p80h2cMkprXPET59tWvZk18jQXxlDGtAxayH/grjIGpo+PJVnJ2MiFPVNiKdmEfXP8qSpzyeaTumDNhPYxzh+Mvj8GppL1vdym9sdAA22fXA/NoYYPC6xhyAVWBhox2qiMFuqCp5XB7vbWm0mzf+qAhRv1T0521sVfBgOl0i4AI8DXI/6m7buiQd0D0JKGXf4pkze/q3+Tsuh5n7jXdAcKIhd3po9KcwAAAABJRU5ErkJggg==";

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let isQuitting = false;

// Single-instance lock: a second launch (or the global shortcut firing
// while already running) should show/focus the existing window, never
// open a duplicate.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    showWindow();
  });

  // Explicit-dismiss only (no more hide-on-blur) — Escape, when the
  // renderer decides nothing more specific (canceling an edit, clearing
  // a copy highlight) should consume it first. See App.tsx.
  ipcMain.on("window:hide-request", (event) => {
    if (!isTrustedSender(event)) return;
    hideWindow();
  });

  // Settings popover's "launch at login" toggle — request/response
  // (invoke/handle), unlike the fire-and-forget channel above, since the
  // renderer needs to read the *current* OS-level setting, not just push
  // a change to it.
  ipcMain.handle("login-item:get", (event) => {
    if (!isTrustedSender(event)) return false;
    return app.getLoginItemSettings().openAtLogin;
  });
  ipcMain.handle("login-item:set", (event, openAtLogin: unknown) => {
    if (!isTrustedSender(event) || typeof openAtLogin !== "boolean") return;
    app.setLoginItemSettings({ openAtLogin });
  });

  // Settings popover's shortcut recorder. set returns whether the new
  // accelerator actually took — see applyShortcut's already-claimed-by-
  // another-app fallback.
  // Settings popover's "check for updates automatically" toggle.
  ipcMain.handle("updates:get", (event) => (isTrustedSender(event) ? getAutoCheckEnabled() : false));
  ipcMain.handle("updates:set", (event, value: unknown) => {
    if (!isTrustedSender(event) || typeof value !== "boolean") return;
    setAutoCheckEnabled(value);
  });

  ipcMain.handle("shortcut:get", (event) => (isTrustedSender(event) ? currentShortcut : ""));
  ipcMain.handle("shortcut:set", (event, accelerator: unknown) => {
    if (!isTrustedSender(event)) return false;
    if (typeof accelerator !== "string" || !ACCELERATOR_PATTERN.test(accelerator)) return false;
    return applyShortcut(accelerator);
  });

  app.on("before-quit", () => {
    isQuitting = true;
    mainWindow?.webContents.send("window:hiding");
  });

  app.on("will-quit", () => {
    globalShortcut.unregisterAll();
  });

  // Background/menu-bar app convention: never quit just because a
  // window closed — only the tray's Quit item (which sets isQuitting
  // above before calling app.quit()) actually exits.
  app.on("window-all-closed", () => {
    // Intentionally empty — overrides Electron's default quit-when-
    // windowless behavior.
  });

  app.whenReady().then(() => {
    // No dock icon and no default application menu — this is a
    // tray-only background app, not a normal dock/menu-bar app.
    app.dock?.hide();
    // Minimal menu rather than none: Cmd+C/V/X/A/Z are delivered through
    // the Edit menu's roles on macOS, so with a null menu copy/paste can
    // silently stop working in text fields. The first menu is the app menu
    // and needs a Quit item, or Cmd+Q does nothing (the shortcut is just
    // that menu item's accelerator). Quit goes through app.quit(), whose
    // before-quit handler lets the window close instead of hiding.
    Menu.setApplicationMenu(
      Menu.buildFromTemplate([
        { label: "PAPI", submenu: [{ role: "quit" }] },
        { role: "editMenu" },
        { label: "Window", submenu: [{ role: "close" }, { role: "minimize" }] },
      ]),
    );

    createWindow();
    createTray();
    startUpdateChecks();
    // applyShortcut's own failure path already re-registers whatever was
    // previously bound (DEFAULT_SHORTCUT, at this point in startup) —
    // it does *not* persist that fallback, so a saved custom shortcut
    // that's temporarily unavailable (another app has it right now)
    // stays in the config file for the next launch to retry, rather
    // than getting silently overwritten with the default.
    const attempted = loadPersistedShortcut();
    const registered = applyShortcut(attempted);
    if (!registered) {
      console.error(
        `Failed to register global shortcut "${attempted}" — likely already claimed by another app. ` +
          `Falling back to "${currentShortcut}"${globalShortcut.isRegistered(currentShortcut) ? "" : " (also unavailable)"}.`,
      );
    }
  });
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 465,
    height: 433,
    show: false,
    // Numi-style chrome: no separate native title bar (which macOS
    // otherwise renders light/white regardless of app theme) — traffic
    // lights float directly over the app's own dark background instead.
    // backgroundColor matches --bg-primary (theme.css) so there's no
    // white flash before the renderer paints, either.
    titleBarStyle: "hiddenInset",
    // Explicit rather than the OS default — the default position was
    // colliding with the tab bar once that got shrunk (Phase E), and an
    // explicit position means App.css's clearance padding can match it
    // exactly instead of guessing at what macOS picked.
    trafficLightPosition: { x: 14, y: 13 },
    backgroundColor: "#1e1e1e",
    webPreferences: {
      // .cjs, forced in electron.vite.config.ts — a default-ESM preload
      // (this project's "type": "module") silently fails to load at all
      // under Electron's default-sandboxed renderer; see that config's
      // comment for the full story.
      preload: join(__dirname, "../preload/index.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  // The app is a single local page: never open new windows, and never
  // navigate anywhere but the app's own entry page. Exact-match, not a
  // "file://" prefix — dropping a local .html file on the window triggers
  // a navigation, and that page would otherwise load with the preload API
  // (hide window, global shortcut, login item) and no CSP.
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  const appEntryUrl = process.env.ELECTRON_RENDERER_URL ?? pathToFileURL(join(__dirname, "../renderer/index.html")).href;
  mainWindow.webContents.on("will-navigate", (event, url) => {
    const isAppPage = url === appEntryUrl || (process.env.ELECTRON_RENDERER_URL !== undefined && url.startsWith(appEntryUrl));
    if (!isAppPage) event.preventDefault();
  });

  // electron-vite sets this env var during `electron-vite dev`, pointing
  // at the Vite dev server; a production build has no dev server, so it
  // loads the bundled renderer output instead.
  const devServerUrl = process.env.ELECTRON_RENDERER_URL;
  if (devServerUrl) {
    mainWindow.loadURL(devServerUrl);
  } else {
    mainWindow.loadFile(join(__dirname, "../renderer/index.html"));
  }

  mainWindow.once("ready-to-show", () => {
    if (mainWindow) showOnCurrentSpace(mainWindow);
  });

  // Same "hide, don't quit" rule for the window's own close button.
  mainWindow.on("close", (event) => {
    if (!isQuitting) {
      event.preventDefault();
      hideWindow();
    }
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

// Shows the window on whichever macOS Space the user is currently on,
// instead of always jumping them to wherever the window last was (its
// default behavior — normally a window belongs to one specific Space).
// Briefly marking it visible on *every* Space right before show() is
// what makes macOS place it on the current one; resetting that back to
// false shortly after (not synchronously — see below) leaves it a
// normal single-Space window the rest of the time, so it still behaves
// like every other window in Mission Control/the Space switcher.
//
// A prior attempt at this broke the app (default Electron Dock icon
// appeared, window went invisible). Root cause, confirmed this time by
// actually checking the Dock after packaging: setVisibleOnAllWorkspaces
// makes macOS run an "activation policy" transform on the app as a side
// effect, independent of app.dock.hide() — which is exactly what pulls
// the Dock icon back. skipTransformProcessType:true (on *both* calls
// below) is Electron's documented way to suppress that transform; the
// prior attempt didn't set it. Verified via a real packaged-app launch
// (screenshot of the Dock — see conversation) that the icon now stays
// hidden with this flag in place, not just by reasoning about the docs.
//
// Reset back to false on a short delay rather than synchronously —
// macOS's Space assignment isn't necessarily synchronous with the
// Electron call, so resetting before that settles risks the same kind
// of race; isDestroyed() guards the rare case the window closes again
// within that window.
function showOnCurrentSpace(window: BrowserWindow): void {
  window.setVisibleOnAllWorkspaces(true, {
    visibleOnFullScreen: true,
    skipTransformProcessType: true,
  });
  window.show();
  window.focus();
  // Deterministic "the window is actually visible again" signal for the
  // renderer (App.tsx re-focuses the active tab's primary input on
  // this) — hide()/show() doesn't unmount the React tree, so a
  // mount-only focus effect never re-runs on its own, and neither
  // document.visibilitychange nor window's "focus" DOM event reliably
  // fire for this specific hide/show cycle across platforms/Electron
  // versions, so an explicit push here is the only fully reliable
  // option.
  window.webContents.send("window:shown");
  setTimeout(() => {
    if (!window.isDestroyed()) {
      window.setVisibleOnAllWorkspaces(false, { skipTransformProcessType: true });
    }
  }, 100);
}

// Tells the renderer to flush any pending debounced autosave before the
// window goes away — hiding doesn't unmount it, but a quit shortly after
// would otherwise lose the last edits still waiting on the debounce timer.
function hideWindow(): void {
  mainWindow?.webContents.send("window:hiding");
  mainWindow?.hide();
}

function showWindow(): void {
  if (!mainWindow) {
    createWindow();
    return;
  }
  showOnCurrentSpace(mainWindow);
}

function toggleWindow(): void {
  if (mainWindow?.isVisible()) {
    hideWindow();
  } else {
    showWindow();
  }
}

function createTray(): void {
  // The embedded PNG is 44x44 (supersampled for a crisp downsample), but
  // createFromDataURL has no way to know that's a @2x representation — it
  // reports the image's *size* as 44x44 points, rendering it twice the
  // intended menu-bar size. Resizing down to the actual 22x22 point size
  // fixes that; the extra source resolution still buys a cleaner result
  // than rasterizing at 22x22 to begin with.
  const image = nativeImage
    .createFromDataURL(`data:image/png;base64,${TRAY_ICON_BASE64}`)
    .resize({ width: 22, height: 22 });
  image.setTemplateImage(true);

  tray = new Tray(image);
  tray.setToolTip("PAPI");
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "Show", click: showWindow },
      { type: "separator" },
      { label: `PAPI ${app.getVersion()}`, enabled: false },
      { label: "Check for Updates…", click: checkForUpdatesNow },
      { label: "Report a Problem…", click: reportBug },
      { type: "separator" },
      {
        label: "Quit",
        click: () => {
          isQuitting = true;
          app.quit();
        },
      },
    ]),
  );
  tray.on("click", toggleWindow);
}
