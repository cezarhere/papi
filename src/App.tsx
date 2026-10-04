import { lazy, Suspense, useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import { DEFAULT_PRECISION, PrecisionContext } from "./PrecisionContext";
import SettingsPopover from "./SettingsPopover";
import UpdateBanner from "./UpdateBanner";
import CalculatorTab from "./tabs/CalculatorTab";
import { initCurrencyRates } from "./tabs/calculator/currencyRates";
// Loaded on first visit to the tab: HyperFormula is the largest single
// dependency and most sessions only ever use the calculator.
const SpreadsheetTab = lazy(() => import("./tabs/SpreadsheetTab"));
import { ToastContext } from "./ToastContext";
import "./App.css";

type TabId = "calculator" | "spreadsheet";

const TOAST_DURATION_MS = 1600;
const PRECISION_STORAGE_KEY = "calculator-precision";
const TAB_STORAGE_KEY = "active-tab";

function loadStoredPrecision(): number {
  const saved = localStorage.getItem(PRECISION_STORAGE_KEY);
  const parsed = saved === null ? NaN : Number(saved);
  return Number.isFinite(parsed) ? parsed : DEFAULT_PRECISION;
}

function loadStoredTab(): TabId {
  const saved = localStorage.getItem(TAB_STORAGE_KEY);
  return saved === "calculator" || saved === "spreadsheet" ? saved : "spreadsheet";
}

export default function App() {
  const [activeTab, setActiveTab] = useState<TabId>(loadStoredTab);
  // Owned here (not just passed down) since this is also what renders it,
  // in the tab bar's empty space — see ToastContext.tsx.
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const toastTimeoutRef = useRef<number | null>(null);

  const showToast = useCallback((message: string) => {
    setToastMessage(message);
    if (toastTimeoutRef.current !== null) window.clearTimeout(toastTimeoutRef.current);
    toastTimeoutRef.current = window.setTimeout(() => setToastMessage(null), TOAST_DURATION_MS);
  }, []);

  // Owned here for the same reason as toastMessage — SettingsPopover (the
  // tab bar) and CalculatorTab (the actual formatting) both need this in
  // sync, see PrecisionContext.tsx.
  const [precision, setPrecisionState] = useState<number>(loadStoredPrecision);
  const setPrecision = useCallback((value: number) => {
    setPrecisionState(value);
    localStorage.setItem(PRECISION_STORAGE_KEY, String(value));
  }, []);

  // Fetch-once-on-launch (CALC_SPEC.md "Currency"). Runs here, not in
  // CalculatorTab, since the app can launch on the Spreadsheet tab —
  // rates should still refresh in the background regardless of which
  // tab is active first.
  useEffect(() => {
    void initCurrencyRates();
  }, []);

  // Persists across actual app restarts, not just hide/show within one
  // running session (which already survives on its own — the window
  // hides rather than unmounting React).
  useEffect(() => {
    localStorage.setItem(TAB_STORAGE_KEY, activeTab);
  }, [activeTab]);

  // Explicit-dismiss Escape (Phase F: no more hide-on-blur). Bubble-phase,
  // on the outermost element — SpreadsheetTab's own Escape handling
  // (cancel an edit, clear a copy highlight) calls stopPropagation when
  // it actually does something, so this only fires as a fallback once
  // nothing more specific consumed the keypress first.
  function handleEscape(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === "Escape") window.electronAPI?.hideWindow();
  }

  return (
    <ToastContext.Provider value={showToast}>
      <PrecisionContext.Provider value={{ precision, setPrecision }}>
        <div className="app" onKeyDown={handleEscape}>
          <div className="tab-bar" role="tablist">
            <button
              role="tab"
              aria-selected={activeTab === "calculator"}
              className={activeTab === "calculator" ? "tab active" : "tab"}
              onClick={() => setActiveTab("calculator")}
            >
              Calculator
            </button>
            <button
              role="tab"
              aria-selected={activeTab === "spreadsheet"}
              className={activeTab === "spreadsheet" ? "tab active" : "tab"}
              onClick={() => setActiveTab("spreadsheet")}
            >
              Spreadsheet
            </button>
            <div className="tab-bar-right">
              {toastMessage && <span className="tab-bar-toast">{toastMessage}</span>}
              <SettingsPopover />
            </div>
          </div>
          <UpdateBanner />
          <div className="tab-content">
            {activeTab === "calculator" ? (
              <CalculatorTab />
            ) : (
              <Suspense fallback={null}>
                <SpreadsheetTab />
              </Suspense>
            )}
          </div>
        </div>
      </PrecisionContext.Provider>
    </ToastContext.Provider>
  );
}
