import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "electron-vite";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Production-only CSP, injected into the built index.html. Skipped in dev
// because Vite's HMR/React-refresh relies on inline scripts and a
// websocket, which a strict policy would block. connect-src allows only the
// currency-rate API (currencyRates.ts); style-src needs 'unsafe-inline'
// because React sets inline style attributes (flex-basis, heights).
// Vite 5 can't resolve chrono-node's wildcard "./*" export map entry, so
// point the English-only entry at its file directly (see classifyLine.ts).
const chronoEn = resolve(__dirname, "node_modules/chrono-node/dist/esm/locales/en/index.js");

const CSP =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; " +
  "img-src 'self' data:; connect-src https://api.frankfurter.dev; " +
  "object-src 'none'; base-uri 'none'; form-action 'none'";
const injectCsp = {
  name: "inject-csp",
  apply: "build" as const,
  transformIndexHtml: () => [
    { tag: "meta", attrs: { "http-equiv": "Content-Security-Policy", content: CSP }, injectTo: "head-prepend" as const },
  ],
};

// Main/preload live under electron/ (not the default src/main, src/
// preload) so they don't collide with the existing React app's src/.
// The renderer, meanwhile, stays exactly where it already is — project
// root index.html + src/ — reusing the same React plugin as the plain
// Vite dev workflow (vite.config.ts) instead of moving the app under
// src/renderer/.
export default defineConfig({
  main: {
    build: {
      rollupOptions: {
        input: resolve(__dirname, "electron/main/index.ts"),
      },
    },
  },
  preload: {
    build: {
      rollupOptions: {
        input: resolve(__dirname, "electron/preload/index.ts"),
        // Forced CommonJS output (not this project's default ESM, driven
        // by package.json's "type": "module") — root-caused a real bug:
        // Electron's default-sandboxed renderer (Electron 20+) can't load
        // an ESM (import/export) preload script at all ("Cannot use
        // import statement outside a module"), so contextBridge's whole
        // exposeInMainWorld call was silently never running, and
        // window.electronAPI was undefined the entire time. CommonJS is
        // the traditional, universally-supported preload format — fixes
        // this without weakening contextIsolation/sandbox anywhere.
        output: {
          format: "cjs",
          entryFileNames: "[name].cjs",
        },
      },
    },
  },
  renderer: {
    root: ".",
    build: {
      rollupOptions: {
        input: resolve(__dirname, "index.html"),
      },
    },
    plugins: [react(), injectCsp],
    resolve: { alias: { "chrono-node/en": chronoEn } },
  },
});
