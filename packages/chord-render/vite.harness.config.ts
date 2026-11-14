import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Dev-only bidi harness: serves local files only (workspace packages).
export default defineConfig({
  root: "harness",
  plugins: [react()],
  server: {
    port: 1421,
    strictPort: true,
    host: "127.0.0.1",
    fs: { allow: ["../../.."] },
  },
});
