import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: process.env.TAURI_DEV_HOST || false,
    watch: { ignored: ["**/src-tauri/**"] },
  },
  envPrefix: ["VITE_", "TAURI_ENV_*"],
  build: {
    target:
      process.env.TAURI_ENV_PLATFORM === "windows" ? "chrome105" : "safari13",
    // Logical CSS must not be lowered to :lang() physical rules (BIDI B3/B8).
    cssTarget:
      process.env.TAURI_ENV_PLATFORM === "windows" ? "chrome105" : "safari15",
    outDir: "dist",
  },
});
