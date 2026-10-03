import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { usePrecision } from "./PrecisionContext";
import "./SettingsPopover.css";

const PRECISION_OPTIONS = [0, 2, 4, 6, 8, 10];

// Feather Icons "settings" glyph (MIT) — a plain gear, matches the app's
// minimal outline aesthetic; inherits color via currentColor so it reacts
// to the button's own hover/focus styling in CSS rather than needing its
// own state.
function GearIcon() {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

// Cosmetic only — the real accelerator string (what Electron actually
// registers) is never touched by this, just how it's displayed.
function formatForDisplay(accelerator: string): string {
  return accelerator
    .replace("CommandOrControl", "⌘")
    .replace("Command", "⌘")
    .replace("Control", "⌃")
    .replace("Option", "⌥")
    .replace("Alt", "⌥")
    .replace("Shift", "⇧")
    .replace(/\+/g, "");
}

// Global shortcuts need at least one modifier — a bare key would either
// be unusable (Electron requires a modifier for most global accelerators
// anyway) or too easy to trigger by accident from any app. Pure-modifier
// keypresses (still holding Shift, nothing else yet) return null so the
// caller keeps waiting for a real combo instead of registering nothing.
function eventToAccelerator(e: KeyboardEvent): string | null {
  if (e.key === "Meta" || e.key === "Control" || e.key === "Alt" || e.key === "Shift") return null;

  const parts: string[] = [];
  if (e.metaKey) parts.push("Command");
  if (e.ctrlKey) parts.push("Control");
  if (e.altKey) parts.push("Option");
  if (e.shiftKey) parts.push("Shift");
  if (parts.length === 0) return null;

  let key = e.key;
  if (key === " ") key = "Space";
  else if (key.length === 1) key = key.toUpperCase();
  // Longer names (ArrowUp, Enter, Escape, Tab, Backspace, ...) already
  // match Electron's accelerator key names as-is for the common cases.

  parts.push(key);
  return parts.join("+");
}

export default function SettingsPopover() {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const { precision, setPrecision } = usePrecision();
  // null while loading (or unavailable — undefined in the plain-browser
  // dev workflow, which has no window.electronAPI at all) — these rows
  // just don't render until there's a real Electron-backed value to show.
  const [launchAtLogin, setLaunchAtLoginState] = useState<boolean | null>(null);
  const [shortcut, setShortcutState] = useState<string | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [shortcutError, setShortcutError] = useState<string | null>(null);

  useEffect(() => {
    window.electronAPI?.getLaunchAtLogin().then(setLaunchAtLoginState);
    window.electronAPI?.getShortcut().then(setShortcutState);
  }, []);

  function handleLaunchAtLoginChange(checked: boolean) {
    setLaunchAtLoginState(checked);
    void window.electronAPI?.setLaunchAtLogin(checked);
  }

  useEffect(() => {
    if (!isOpen) return;
    function handleClickOutside(e: globalThis.MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
        setIsRecording(false);
      }
    }
    window.addEventListener("mousedown", handleClickOutside);
    return () => window.removeEventListener("mousedown", handleClickOutside);
  }, [isOpen]);

  // Also close when the window itself loses focus (clicking another app).
  useEffect(() => {
    if (!isOpen) return;
    function handleBlur() {
      setIsOpen(false);
      setIsRecording(false);
    }
    window.addEventListener("blur", handleBlur);
    return () => window.removeEventListener("blur", handleBlur);
  }, [isOpen]);

  async function commitAccelerator(accelerator: string) {
    const ok = await window.electronAPI?.setShortcut(accelerator);
    setIsRecording(false);
    if (ok) {
      setShortcutState(accelerator);
      setShortcutError(null);
    } else {
      setShortcutError("Already in use by another app");
    }
  }

  function handleKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (isRecording) {
      // Stays within this component entirely — never reaches the
      // popover-close or window-hide Escape handling below.
      e.preventDefault();
      e.stopPropagation();
      if (e.key === "Escape") {
        setIsRecording(false);
        return;
      }
      const accelerator = eventToAccelerator(e);
      if (accelerator) void commitAccelerator(accelerator);
      return;
    }
    if (e.key === "Escape" && isOpen) {
      // Closing the popover is specific enough that Escape shouldn't also
      // fall through to App.tsx's window-hide fallback.
      e.stopPropagation();
      setIsOpen(false);
    }
  }

  return (
    <div className="settings-container" ref={containerRef} onKeyDown={handleKeyDown}>
      <button
        type="button"
        className="settings-gear-button"
        aria-label="Settings"
        aria-expanded={isOpen}
        onClick={() => setIsOpen((prev) => !prev)}
      >
        <GearIcon />
      </button>
      {/* The tab bar is a window-drag region (-webkit-app-region: drag), and
          macOS swallows clicks there before the page sees them — so the
          mousedown-outside listener above never fires for clicks on the
          empty tab bar. A transparent full-window no-drag backdrop gives
          those clicks somewhere to land. */}
      {isOpen && (
        <div
          className="settings-backdrop"
          onMouseDown={() => {
            setIsOpen(false);
            setIsRecording(false);
          }}
        />
      )}
      {isOpen && (
        <div className="settings-popover" role="dialog" aria-label="Settings">
          <label className="settings-row">
            <span>Precision</span>
            <select
              value={precision}
              onChange={(e) => setPrecision(Number(e.target.value))}
            >
              {PRECISION_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>
          {launchAtLogin !== null && (
            <label className="settings-row">
              <span>Launch at login</span>
              <input
                type="checkbox"
                checked={launchAtLogin}
                onChange={(e) => handleLaunchAtLoginChange(e.target.checked)}
              />
            </label>
          )}
          {shortcut !== null && (
            <div className="settings-row">
              <span>Shortcut</span>
              <button
                type="button"
                className="settings-shortcut-button"
                onClick={() => {
                  setShortcutError(null);
                  setIsRecording(true);
                }}
              >
                {isRecording ? "Press a key…" : formatForDisplay(shortcut)}
              </button>
            </div>
          )}
          {shortcutError && <div className="settings-shortcut-error">{shortcutError}</div>}
        </div>
      )}
    </div>
  );
}
