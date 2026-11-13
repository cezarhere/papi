import { contextBridge, ipcRenderer } from "electron";

// Tells the main process once the renderer has had its turn at a
// "window:hiding" message — i.e. once every tab's flush-to-storage listener
// (registered below, via onWindowHiding) has run. Quit waits for this, so
// edits made in the last half second aren't lost to the autosave debounce.
// The timeout lets those listeners, which were registered later, go first.
ipcRenderer.on("window:hiding", () => {
  setTimeout(() => ipcRenderer.send("window:flushed"), 0);
});

// Renderer-facing API surface. Kept minimal — the renderer only reaches
// into Node/Electron APIs for the handful of things that genuinely need
// main-process access (window lifecycle, OS-level login item settings).
contextBridge.exposeInMainWorld("electronAPI", {
  // Explicit dismiss (Escape, when nothing more specific consumed it) —
  // the window no longer hides itself on blur, see main/index.ts.
  hideWindow(): void {
    ipcRenderer.send("window:hide-request");
  },
  // Settings popover's "launch at login" toggle.
  getLaunchAtLogin(): Promise<boolean> {
    return ipcRenderer.invoke("login-item:get");
  },
  setLaunchAtLogin(value: boolean): Promise<void> {
    return ipcRenderer.invoke("login-item:set", value);
  },
  // Settings popover's shortcut recorder. set resolves to whether the
  // new accelerator actually took (false if another app already has it).
  getShortcut(): Promise<string> {
    return ipcRenderer.invoke("shortcut:get");
  },
  setShortcut(accelerator: string): Promise<boolean> {
    return ipcRenderer.invoke("shortcut:set", accelerator);
  },
  // Fired every time the window is actually shown (cold launch and
  // every tray/shortcut reshow) — see main/index.ts's showOnCurrentSpace.
  // Hiding doesn't unmount the React tree, so this is the only reliable
  // way for a tab to know "you're visible again, re-focus your primary
  // input" instead of leaving focus wherever it last happened to land.
  // Returns an unsubscribe function for effect cleanup.
  onWindowShown(callback: () => void): () => void {
    const listener = () => callback();
    ipcRenderer.on("window:shown", listener);
    return () => ipcRenderer.removeListener("window:shown", listener);
  },
  // Fired just before the window hides or the app quits — flush pending
  // debounced saves. Returns an unsubscribe function.
  onWindowHiding(callback: () => void): () => void {
    const listener = () => callback();
    ipcRenderer.on("window:hiding", listener);
    return () => ipcRenderer.removeListener("window:hiding", listener);
  },
  // Settings popover's "check for updates automatically" toggle.
  getAutoUpdate(): Promise<boolean> {
    return ipcRenderer.invoke("updates:get");
  },
  setAutoUpdate(value: boolean): Promise<void> {
    return ipcRenderer.invoke("updates:set", value);
  },
  // In-app update banner: state pushes from the main process, plus the
  // buttons' actions. Returns an unsubscribe function.
  onUpdateState(callback: (state: unknown) => void): () => void {
    const listener = (_event: unknown, state: unknown) => callback(state);
    ipcRenderer.on("update:state", listener);
    return () => ipcRenderer.removeListener("update:state", listener);
  },
  downloadUpdate(): void {
    ipcRenderer.send("updates:download");
  },
  installUpdate(): void {
    ipcRenderer.send("updates:install");
  },
  // Settings → Appearance: "system", "light" or "dark".
  getAppearance(): Promise<string> {
    return ipcRenderer.invoke("appearance:get");
  },
  setAppearance(value: string): Promise<void> {
    return ipcRenderer.invoke("appearance:set", value);
  },
  // The accent colour chosen in System Settings, as "#rrggbb".
  getAccentColor(): Promise<string | null> {
    return ipcRenderer.invoke("appearance:accent");
  },
  onAccentColor(callback: (color: string) => void): () => void {
    const listener = (_event: unknown, color: unknown) => {
      if (typeof color === "string") callback(color);
    };
    ipcRenderer.on("appearance:accent-changed", listener);
    return () => ipcRenderer.removeListener("appearance:accent-changed", listener);
  },
  // Commands chosen from the app menu, the tray menu or the grid's context
  // menu ("settings", "tab:calculator", "copy", "clear", …).
  onMenuCommand(callback: (command: string) => void): () => void {
    const listener = (_event: unknown, command: unknown) => {
      if (typeof command === "string") callback(command);
    };
    ipcRenderer.on("menu:command", listener);
    return () => ipcRenderer.removeListener("menu:command", listener);
  },
  // The system clipboard, as plain text (the spreadsheet grid's copy/paste).
  readClipboard(): Promise<string> {
    return ipcRenderer.invoke("clipboard:read");
  },
  writeClipboard(text: string): void {
    ipcRenderer.send("clipboard:write", text);
  },
  // Pops up the native context menu for the spreadsheet grid.
  showGridMenu(): void {
    ipcRenderer.send("menu:grid");
  },
});
