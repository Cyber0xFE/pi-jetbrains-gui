import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The bundle is inlined into a single HTML file by scripts/inline.mjs: the webview is loaded with
// JBCefBrowser.loadHTML(), which has no base URL to resolve relative assets against.
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    target: "chrome110",
    cssCodeSplit: false,
    modulePreload: false,
    assetsInlineLimit: Number.MAX_SAFE_INTEGER,
    rollupOptions: {
      output: {
        format: "iife",
        inlineDynamicImports: true,
      },
    },
  },
  test: {
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    environment: "jsdom",
  },
});
