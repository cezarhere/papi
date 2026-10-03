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
    onWindowShown(callback: () => void): () => void;
  };
}
