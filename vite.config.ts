import { defineConfig } from "vite";

// Tauri expects a fixed dev port and serves the built frontend from ../dist
export default defineConfig({
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    watch: {
      // don't reload the frontend when Rust files change
      ignored: ["**/src-tauri/**"],
    },
  },
  build: {
    target: "es2021",
    sourcemap: false,
  },
});
