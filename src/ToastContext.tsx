import { createContext, useContext } from "react";

// App.tsx provides the real implementation (it's the one rendering the
// toast in the tab bar); this default no-op just means components don't
// need a null-check if somehow rendered outside the provider.
export const ToastContext = createContext<(message: string) => void>(() => {});

export function useToast(): (message: string) => void {
  return useContext(ToastContext);
}
