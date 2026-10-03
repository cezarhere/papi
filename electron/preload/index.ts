import { contextBridge, ipcRenderer } from "electron";

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
});
