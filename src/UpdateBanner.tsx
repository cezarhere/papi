import { useEffect, useState } from "react";
import { useToast } from "./ToastContext";
import "./UpdateBanner.css";

// Mirrors electron/main/updates.ts's UpdateState. Update prompts live in
// PAPI's own window rather than native dialogs (see the comment there for
// why): always visible, themed, and the buttons are plain HTML.
type UpdateState =
  | { status: "available"; version: string }
  | { status: "downloading"; version: string; percent: number }
  | { status: "ready"; version: string }
  | { status: "none" }
  | { status: "error" };

function isUpdateState(value: unknown): value is UpdateState {
  if (typeof value !== "object" || value === null) return false;
  const status = (value as { status?: unknown }).status;
  return (
    status === "available" ||
    status === "downloading" ||
    status === "ready" ||
    status === "none" ||
    status === "error"
  );
}

export default function UpdateBanner() {
  const [state, setState] = useState<UpdateState | null>(null);
  const showToast = useToast();

  useEffect(() => {
    return window.electronAPI?.onUpdateState((incoming) => {
      if (!isUpdateState(incoming)) return;
      if (incoming.status === "none") {
        showToast("You're up to date");
        setState(null);
      } else if (incoming.status === "error") {
        showToast("Couldn't check for updates");
        setState(null);
      } else {
        setState(incoming);
      }
    });
  }, [showToast]);

  if (!state) return null;

  return (
    <div className="update-banner" role="status">
      {state.status === "available" && (
        <>
          <span className="update-banner-text">PAPI {state.version} is available</span>
          <button
            type="button"
            className="update-banner-button update-banner-primary"
            onClick={() => window.electronAPI?.downloadUpdate()}
          >
            Download
          </button>
          <button type="button" className="update-banner-button" onClick={() => setState(null)}>
            Not now
          </button>
        </>
      )}
      {state.status === "downloading" && (
        <span className="update-banner-text">
          Downloading PAPI {state.version}… {state.percent}%
        </span>
      )}
      {state.status === "ready" && (
        <>
          <span className="update-banner-text">PAPI {state.version} is ready</span>
          <button
            type="button"
            className="update-banner-button update-banner-primary"
            onClick={() => window.electronAPI?.installUpdate()}
          >
            Restart now
          </button>
          <button type="button" className="update-banner-button" onClick={() => setState(null)}>
            Later
          </button>
        </>
      )}
    </div>
  );
}
