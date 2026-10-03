import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const __dirname = dirname(fileURLToPath(import.meta.url));
// Vite 5 can't resolve chrono-node's wildcard "./*" export map entry, so
// point the English-only entry at its file directly (see classifyLine.ts).
const chronoEn = resolve(__dirname, "node_modules/chrono-node/dist/esm/locales/en/index.js");

// jsdom isn't needed: everything under test is pure logic. localStorage
// is stubbed per-file where a module reads it at import time.
export default defineConfig({
  resolve: { alias: { "chrono-node/en": chronoEn } },
  test: { environment: "node", include: ["src/**/__tests__/**/*.test.ts"] },
});
