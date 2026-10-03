import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const __dirname = dirname(fileURLToPath(import.meta.url));
// Vite 5 can't resolve chrono-node's wildcard "./*" export map entry, so
// point the English-only entry at its file directly (see classifyLine.ts).
const chronoEn = resolve(__dirname, "node_modules/chrono-node/dist/esm/locales/en/index.js");

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { "chrono-node/en": chronoEn } },
});
