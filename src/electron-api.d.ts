// Matches electron/preload/index.ts's contextBridge exposure. Optional
// because the plain-browser dev workflow (`npm run dev`) runs this same
// renderer code with no Electron preload present at all.
interface Window {
  electronAPI?: {
    hideWindow(): void;
    getLaunchAtLogin(): Promise<boolean>;
    setLaunchAtLogin(value: boolean): Promise<void>;
    getShortcut(): Promise<string>;
    setShortcut(accelerator: string): Promise<boolean>;
    getAutoUpdate(): Promise<boolean>;
    setAutoUpdate(value: boolean): Promise<void>;
    onUpdateState(callback: (state: unknown) => void): () => void;
    downloadUpdate(): void;
    installUpdate(): void;
    onWindowShown(callback: () => void): () => void;
    onWindowHiding(callback: () => void): () => void;
    // The system accent colour as "#rrggbb" (and again whenever the user
    // changes it in System Settings).
    getAccentColor(): Promise<string | null>;
    onAccentColor(callback: (color: string) => void): () => void;
    // Commands from the app menu, the tray menu and the grid's context
    // menu: "settings", "tab:calculator", "tab:spreadsheet", and for the
    // grid "cut", "copy", "paste", "clear", "clear-format".
    onMenuCommand(callback: (command: string) => void): () => void;
    // Pops up the native context menu for the spreadsheet grid.
    showGridMenu(): void;
  };
}
