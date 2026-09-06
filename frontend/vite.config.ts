/// <reference types="vitest/config" />
import { defineConfig, type PluginOption } from "vite";
import type { ServerResponse } from "node:http";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";
// The same header list Caddy serves in production (deploy/security-headers.json).
// `vite preview` is the local ZAP stand's front door, and a stand that answers
// with different headers than production would report findings nobody can act on.
import securityHeaders from "../deploy/security-headers.json";

// Serves the production security headers on EVERY preview response — static
// assets and proxied /api/* alike — the way Caddy does in production. Runs as a
// pre-middleware so the values are already on the response when http-proxy copies
// the upstream ones, and drops the headers Caddy strips (`Server`, which hands a
// scanner the exact uvicorn/Caddy version to look up).
function securityHeadersPlugin(): PluginOption {
  const apply = (res: ServerResponse) => {
    for (const [name, value] of Object.entries(securityHeaders.common)) {
      res.setHeader(name, value);
    }
    const writeHead = res.writeHead.bind(res);
    res.writeHead = ((...args: Parameters<ServerResponse["writeHead"]>) => {
      for (const name of securityHeaders.removeHeaders) res.removeHeader(name);
      return writeHead(...args);
    }) as ServerResponse["writeHead"];
  };

  return {
    name: "cubr-security-headers",
    configurePreviewServer(server) {
      server.middlewares.use((_req, res, next) => {
        apply(res);
        next();
      });
    },
  };
}

// One /api proxy definition, used by both `vite dev` and `vite preview`, so the
// ZAP stand routes to FastAPI exactly the way the dev server does.
const apiProxy = {
  "/api": {
    target: "http://127.0.0.1:8000",
    changeOrigin: true,
    rewrite: (p: string) => p.replace(/^\/api/, ""),
    ws: true,
  },
};

// server.host is pinned to 127.0.0.1: Vite otherwise binds IPv6 (::1), which the
// dev workflow ("npm run dev -- --host 127.0.0.1") and some Windows setups miss.
export default defineConfig({
  plugins: [react(), securityHeadersPlugin()],
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
    // Duel WS (plan: stage4-duel-by-link) rides the SAME /api prefix as REST so
    // the httpOnly cookie stays same-origin — apiProxy's `ws: true` lets Vite
    // forward the Upgrade handshake for /api/duel/ws/... through this proxy too.
    // HTTP routing is unaffected: Vite only switches to the WS-forwarding path
    // on a genuine Upgrade request.
    proxy: apiProxy,
  },

  // The local security stand: `npm run build && npm run preview` serves the real
  // production bundle behind the production security headers, with /api proxied
  // to a locally running FastAPI. Point ZAP here — never at the live site, whose
  // database an active scan would fill with junk accounts and duels.
  preview: {
    host: "127.0.0.1",
    port: 4173,
    // Headers come from the plugin above, NOT from `preview.headers`: that option
    // only decorates Vite's own static responses, so /api/* would come back bare
    // and a scan of the stand would report header findings production does not
    // have (and hide ones it does).
    proxy: apiProxy,
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
