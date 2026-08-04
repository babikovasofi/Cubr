// Guards the one line of deploy config nothing else can catch.
//
// vercel.json rewrites `/api/*` to the backend origin, and Vercel reads that
// file from the repo BEFORE the build — no env var, no build step can fill the
// host in. So the failure mode is a deploy that builds, serves, looks fine, and
// 404s every single API call: login, solves, tournament. Nothing in tsc, eslint
// or vitest sees it, because nothing about it is TypeScript.
//
// Runs as npm's `prebuild`. On Vercel's own production build a leftover
// placeholder is fatal; anywhere else (local `npm run build`, a preview
// deploy that intentionally points elsewhere) it is a warning, so building
// the SPA offline never depends on the deploy config being finished.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const CONFIG = join(HERE, "..", "vercel.json");
const PLACEHOLDER = "REPLACE_WITH_BACKEND_URL_AT_DEPLOY";

const config = JSON.parse(readFileSync(CONFIG, "utf8"));
const apiRewrite = (config.rewrites ?? []).find((r) => r.source === "/api/(.*)");

const problems = [];

if (!apiRewrite) {
  problems.push("vercel.json has no `/api/(.*)` rewrite — the SPA would call its own origin.");
} else if (apiRewrite.destination.includes(PLACEHOLDER)) {
  problems.push(
    `vercel.json still points /api at the placeholder host (${PLACEHOLDER}). ` +
      "Put the real backend origin there — see docs/deploy.md.",
  );
} else if (!apiRewrite.destination.startsWith("https://")) {
  // A plain-http backend makes the auth cookie (Secure everywhere but local)
  // unusable, and browsers block the mixed-content request anyway.
  problems.push(`vercel.json points /api at a non-https origin: ${apiRewrite.destination}`);
}

if (problems.length === 0) process.exit(0);

const fatal = process.env.VERCEL === "1" && process.env.VERCEL_ENV === "production";
const prefix = fatal ? "ERROR" : "warning";
for (const p of problems) console.error(`[check-api-proxy] ${prefix}: ${p}`);

if (fatal) process.exit(1);
