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
        // Duel WS (plan: stage4-duel-by-link) rides the SAME /api prefix as
        // REST so the httpOnly cookie stays same-origin — `ws: true` lets
        // Vite forward the Upgrade handshake for /api/duel/ws/... through
        // this proxy too. HTTP routing above is unaffected: Vite only
        // switches to the WS-forwarding path on a genuine Upgrade request.
        ws: true,
      },
    },
  },
  test: {
    environment: "node",
    globals: true,
    // Pins the interface language so the suite does not read a different one on
    // CI than on a laptop — see the file for what that cost.
    setupFiles: ["./tests/setup.ts"],
    // .tsx added for RTL page tests (tests/tournament/TournamentPage.test.tsx);
    // existing .ts tests are untouched by this glob widening.
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
  },
});
