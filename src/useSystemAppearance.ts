import { useEffect } from "react";

// Marks the document as running inside the Electron shell (where the window
// has a translucent "vibrancy" backdrop the chrome lets show through) and
// keeps --accent in step with the accent colour chosen in System Settings.
// In a plain browser neither applies: the stylesheet's own defaults stand.
export function useSystemAppearance(): void {
  useEffect(() => {
    const api = window.electronAPI;
    if (!api) return;
    const root = document.documentElement;
    root.classList.add("is-electron");
    const apply = (color: string | null) => {
      if (color && /^#[0-9a-f]{6}$/i.test(color)) root.style.setProperty("--accent", color);
    };
    void api.getAccentColor?.().then(apply);
    return api.onAccentColor?.(apply);
  }, []);
}
