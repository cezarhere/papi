import { cpSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  app,
  BrowserWindow,
  clipboard,
  globalShortcut,
  ipcMain,
  Menu,
  nativeImage,
  screen,
  shell,
  systemPreferences,
  Tray,
} from "electron";
import { release } from "node:os";
import {
  checkForUpdatesNow,
  downloadUpdateNow,
  getAutoCheckEnabled,
  installUpdateNow,
  setAutoCheckEnabled,
  startUpdateChecks,
} from "./updates";

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
  // Development escape hatch: point a test run at a throwaway data folder
  // so it can't touch the installed app's saved sheets and settings.
  const override = process.env.PAPI_USER_DATA_DIR;
  if (override && !app.isPackaged) {
    mkdirSync(override, { recursive: true });
    app.setPath("userData", override);
    return;
  }
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
// Opens the bug-report issue form with the version and system fields
// prefilled (form fields are addressed by their `id` in bug_report.yml).
// Blank issues are disabled in the repo, so a plain /issues/new?body= link
// would be redirected to the template chooser and lose the text.
function reportBug(): void {
  const params = new URLSearchParams({
    template: "bug_report.yml",
    version: app.getVersion(),
    macos: `Darwin ${release()}, ${process.arch === "arm64" ? "Apple Silicon" : process.arch}`,
  });
  void shell.openExternal(`${REPO_URL}/issues/new?${params.toString()}`);
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

  // Update banner buttons (src/UpdateBanner.tsx).
  ipcMain.on("updates:download", (event) => {
    if (isTrustedSender(event)) downloadUpdateNow();
  });
  ipcMain.on("updates:install", (event) => {
    if (!isTrustedSender(event)) return;
    installUpdateNow(() => {
      mainWindow?.webContents.send("window:hiding"); // flush pending autosaves
      isQuitting = true; // let the window actually close instead of hiding
    });
  });

  ipcMain.handle("shortcut:get", (event) => (isTrustedSender(event) ? currentShortcut : ""));
  ipcMain.handle("shortcut:set", (event, accelerator: unknown) => {
    if (!isTrustedSender(event)) return false;
    if (typeof accelerator !== "string" || !ACCELERATOR_PATTERN.test(accelerator)) return false;
    return applyShortcut(accelerator);
  });

  // Quitting waits (briefly) for the renderer to write out any edits still
  // sitting in its autosave debounce: the first before-quit is held back,
  // the renderer is told to flush, and the quit goes ahead once it answers
  // — or after a short timeout, so a hung renderer can never block quitting.
  let flushedForQuit = false;
  app.on("before-quit", (event) => {
    isQuitting = true;
    saveWindowBounds();
    if (flushedForQuit || !mainWindow || mainWindow.isDestroyed()) return;
    event.preventDefault();
    flushedForQuit = true;
    let resumed = false;
    const resume = () => {
      if (resumed) return;
      resumed = true;
      ipcMain.removeListener("window:flushed", resume);
      app.quit();
    };
    ipcMain.on("window:flushed", resume);
    setTimeout(resume, 400);
    mainWindow.webContents.send("window:hiding");
  });

  // System clipboard for the spreadsheet grid. A selected cell isn't a text
  // field, so the browser's own paste never reaches it, and the web
  // clipboard API can be refused permission; the main process always can.
  ipcMain.handle("clipboard:read", (event) => (isTrustedSender(event) ? clipboard.readText() : ""));
  ipcMain.on("clipboard:write", (event, text: unknown) => {
    if (!isTrustedSender(event) || typeof text !== "string" || text.length > 5_000_000) return;
    clipboard.writeText(text);
  });

  // System accent colour, for the renderer's --accent.
  ipcMain.handle("appearance:accent", (event) => (isTrustedSender(event) ? accentColor() : null));

  // The spreadsheet grid's context menu. A real native menu; its items come
  // back to the renderer as commands (the grid isn't a text field, so the
  // standard cut/copy/paste roles wouldn't know what to act on).
  ipcMain.on("menu:grid", (event) => {
    if (!isTrustedSender(event) || !mainWindow) return;
    Menu.buildFromTemplate([
      { label: "Cut", click: () => sendCommand("cut") },
      { label: "Copy", click: () => sendCommand("copy") },
      { label: "Paste", click: () => sendCommand("paste") },
      { type: "separator" },
      { label: "Clear Contents", click: () => sendCommand("clear") },
      { label: "Clear Formatting", click: () => sendCommand("clear-format") },
      { type: "separator" },
      { label: "Insert Row Above", click: () => sendCommand("row-above") },
      { label: "Insert Row Below", click: () => sendCommand("row-below") },
      { label: "Insert Column Left", click: () => sendCommand("col-left") },
      { label: "Insert Column Right", click: () => sendCommand("col-right") },
      { type: "separator" },
      { label: "Delete Rows", click: () => sendCommand("delete-rows") },
      { label: "Delete Columns", click: () => sendCommand("delete-cols") },
    ]).popup({ window: mainWindow });
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
    // As a menu-bar (accessory) app PAPI has no visible menu bar, but the
    // menu still supplies every standard shortcut: Cmd+, Cmd+1/2, Cmd+W,
    // Cmd+M, Cmd+H, Cmd+Q.
    Menu.setApplicationMenu(
      Menu.buildFromTemplate([
        {
          label: "PAPI",
          submenu: [
            { role: "about" },
            { label: "Check for Updates…", click: checkForUpdatesNow },
            { type: "separator" },
            { label: "Settings…", accelerator: "Command+,", click: openSettings },
            { type: "separator" },
            { role: "hide" },
            { role: "hideOthers" },
            { role: "unhide" },
            { type: "separator" },
            { role: "quit" },
          ],
        },
        { role: "editMenu" },
        {
          label: "View",
          submenu: [
            { label: "Calculator", accelerator: "Command+1", click: () => sendCommand("tab:calculator") },
            { label: "Spreadsheet", accelerator: "Command+2", click: () => sendCommand("tab:spreadsheet") },
          ],
        },
        { label: "Window", submenu: [{ role: "close" }, { role: "minimize" }, { role: "zoom" }] },
        { role: "help", submenu: [{ label: "Report a Problem…", click: reportBug }] },
      ]),
    );

    systemPreferences.on("accent-color-changed", () => {
      mainWindow?.webContents.send("appearance:accent-changed", accentColor());
    });

    createWindow();
    createTray();
    startUpdateChecks(presentMainWindow, () => mainWindow);
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

// "#rrggbb" of the accent colour chosen in System Settings.
function accentColor(): string | null {
  try {
    const color = systemPreferences.getAccentColor(); // "rrggbbaa"
    return /^[0-9a-f]{8}$/i.test(color) ? `#${color.slice(0, 6)}` : null;
  } catch {
    return null;
  }
}

function sendCommand(command: string): void {
  mainWindow?.webContents.send("menu:command", command);
}

function openSettings(): void {
  showWindow();
  sendCommand("settings");
}

// Window size and position are remembered between launches, in a small
// JSON file next to the other main-process settings.
const DEFAULT_WINDOW_SIZE = { width: 560, height: 460 };
const MIN_WINDOW_SIZE = { width: 380, height: 300 };

function windowStatePath(): string {
  return join(app.getPath("userData"), "window.json");
}

function loadWindowBounds(): Electron.Rectangle | null {
  try {
    if (!existsSync(windowStatePath())) return null;
    const parsed: unknown = JSON.parse(readFileSync(windowStatePath(), "utf-8"));
    if (!parsed || typeof parsed !== "object") return null;
    const { x, y, width, height } = parsed as Record<string, unknown>;
    if (![x, y, width, height].every((value) => typeof value === "number" && Number.isFinite(value))) return null;
    const bounds = {
      x: Math.round(x as number),
      y: Math.round(y as number),
      width: Math.max(MIN_WINDOW_SIZE.width, Math.round(width as number)),
      height: Math.max(MIN_WINDOW_SIZE.height, Math.round(height as number)),
    };
    // Only reuse a position that's still on a connected display (an external
    // monitor may have been unplugged since).
    const area = screen.getDisplayMatching(bounds).workArea;
    const visible =
      bounds.x < area.x + area.width - 60 &&
      bounds.x + bounds.width > area.x + 60 &&
      bounds.y >= area.y &&
      bounds.y < area.y + area.height - 60;
    return visible ? bounds : { ...bounds, x: area.x + 40, y: area.y + 40 };
  } catch {
    return null;
  }
}

function saveWindowBounds(): void {
  if (!mainWindow || mainWindow.isDestroyed() || mainWindow.isFullScreen() || mainWindow.isMinimized()) return;
  try {
    writeFileSync(windowStatePath(), JSON.stringify(mainWindow.getNormalBounds()));
  } catch (error) {
    console.error("Failed to persist window bounds:", error);
  }
}

function createWindow(): void {
  const savedBounds = loadWindowBounds();
  mainWindow = new BrowserWindow({
    ...(savedBounds ?? DEFAULT_WINDOW_SIZE),
    minWidth: MIN_WINDOW_SIZE.width,
    minHeight: MIN_WINDOW_SIZE.height,
    show: false,
    // Numi-style chrome: no separate native title bar (which macOS
    // otherwise renders light/white regardless of app theme) — traffic
    // lights float directly over the app's own dark background instead.
    // The window's background is a system vibrancy material (follows light
    // and dark appearance on its own): the app's title bar, toolbar and
    // status bar are translucent over it, the content area is opaque. The
    // transparent backgroundColor is what lets the material show.
    titleBarStyle: "hiddenInset",
    vibrancy: "under-window",
    visualEffectState: "followWindow",
    // Explicit rather than the OS default — the default position was
    // colliding with the tab bar once that got shrunk (Phase E), and an
    // explicit position means App.css's clearance padding can match it
    // exactly instead of guessing at what macOS picked.
    trafficLightPosition: { x: 14, y: 13 },
    backgroundColor: "#00000000",
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

  // Remember where the window was put (debounced: these fire continuously
  // during a drag).
  let boundsTimer: NodeJS.Timeout | null = null;
  const scheduleBoundsSave = () => {
    if (boundsTimer) clearTimeout(boundsTimer);
    boundsTimer = setTimeout(saveWindowBounds, 400);
  };
  mainWindow.on("resize", scheduleBoundsSave);
  mainWindow.on("move", scheduleBoundsSave);

  // Text fields get the standard edit menu on right-click (Electron has no
  // context menu of its own). The spreadsheet grid asks for its own menu
  // over IPC instead ("menu:grid").
  mainWindow.webContents.on("context-menu", (_event, params) => {
    if (!params.isEditable || !mainWindow) return;
    Menu.buildFromTemplate([
      { role: "cut" },
      { role: "copy" },
      { role: "paste" },
      { type: "separator" },
      { role: "selectAll" },
    ]).popup({ window: mainWindow });
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

// For update dialogs: bring the window forward on the current Space and hand
// it back, so the dialog can be attached to it (see updates.ts).
function presentMainWindow(): BrowserWindow | null {
  if (!mainWindow || mainWindow.isDestroyed()) return null;
  showOnCurrentSpace(mainWindow);
  return mainWindow;
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
  // Left-click shows/hides the window; right-click (or Control-click) opens
  // the menu. The menu is popped up by hand rather than attached with
  // setContextMenu, which on macOS would open it on *every* click and leave
  // no click for toggling.
  const menu = Menu.buildFromTemplate([
    { label: "Show PAPI", click: showWindow },
    { label: "Settings…", click: openSettings },
    { type: "separator" },
    { label: `Version ${app.getVersion()}`, enabled: false },
    { label: "Check for Updates…", click: checkForUpdatesNow },
    { label: "Report a Problem…", click: reportBug },
    { type: "separator" },
    { label: "Quit PAPI", click: () => app.quit() },
  ]);
  tray.on("click", (event) => {
    if (event.ctrlKey) tray?.popUpContextMenu(menu);
    else toggleWindow();
  });
  tray.on("right-click", () => tray?.popUpContextMenu(menu));
}
