import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// Public dashboard dev server. The backend (FastAPI) must allow this origin
// in BACKEND_CORS_ORIGINS (default already includes http://localhost:5173).
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
  },
  build: {
    // MapLibre GL + deck.gl live behind React.lazy; keep them out of the
    // critical bundle so the shell paints first (spec dashboard-web-ui).
    rollupOptions: {
      output: {
        manualChunks: undefined,
      },
    },
  },
});
