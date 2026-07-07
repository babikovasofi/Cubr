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
  },
  test: {
    environment: "node",
    globals: true,
    include: ["tests/**/*.test.ts"],
  },
});
