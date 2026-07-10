/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";

// server.host is pinned to 127.0.0.1: Vite otherwise binds IPv6 (::1), which the
// dev workflow ("npm run dev -- --host 127.0.0.1") and some Windows setups miss.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  server: {
    host: "127.0.0.1",
    // Same-origin dev proxy (plan §B, skeptic HIGH): the httpOnly SameSite=Lax
    // `cubr_auth` cookie and the Google OAuth redirect only survive if the browser
    // sees the API on the SAME origin as the SPA. The frontend fetches ONLY relative
    // `/api/...` URLs (never an absolute backend URL); Vite forwards them to FastAPI
    // and strips the `/api` prefix, since the backend serves auth at root.
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8000",
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/api/, ""),
      },
    },
  },
  test: {
    environment: "node",
    globals: true,
    include: ["tests/**/*.test.ts"],
  },
});
