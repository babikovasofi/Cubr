#!/usr/bin/env node
// Renders deploy/security-headers.json into the Caddy snippets the Caddyfile
// imports. Two front doors serve this site — Caddy in production and
// `vite preview` on the local ZAP stand — and a header list maintained twice
// drifts the moment someone edits one copy: the stand then scans a site that
// is not the site users get. So the JSON is the source, this script renders
// the Caddy half, and frontend/tests/security/headers.test.ts fails the build
// if the rendered file is stale.
//
// Usage: node deploy/scripts/gen-security-headers.mjs [--check]
//   --check  exits 1 instead of writing, for CI.

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const deployDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE = join(deployDir, "security-headers.json");
const TARGET = join(deployDir, "security-headers.caddy");

// Caddy takes a header value as one token: quote it, and escape the quotes a
// CSP never contains but a future header might.
const quote = (value) => `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;

function block(name, headers, removals = []) {
  const lines = [
    ...removals.map((h) => `\t\t-${h}`),
    ...Object.entries(headers).map(([key, value]) => `\t\t${key} ${quote(value)}`),
  ];
  return [`(${name}) {`, "\theader {", ...lines, "\t}", "}"].join("\n");
}

export function render(spec) {
  return [
    "# GENERATED FILE — do not edit.",
    "# Source: deploy/security-headers.json",
    "# Regenerate: node deploy/scripts/gen-security-headers.mjs",
    "",
    "# Every response, http and https alike.",
    block("security_headers", spec.common, spec.removeHeaders ?? []),
    "",
    "# HTTPS only: HSTS on a plain-http local stand would pin localhost to TLS",
    "# in the tester's browser and lock them out of every other localhost app.",
    block("hsts", spec.httpsOnly),
    "",
  ].join("\n");
}

const spec = JSON.parse(readFileSync(SOURCE, "utf8"));
const rendered = render(spec);

if (process.argv.includes("--check")) {
  const current = readFileSync(TARGET, "utf8");
  if (current !== rendered) {
    console.error("security-headers.caddy is stale — run node deploy/scripts/gen-security-headers.mjs");
    process.exit(1);
  }
  console.log("security-headers.caddy up to date");
} else {
  writeFileSync(TARGET, rendered);
  console.log(`wrote ${TARGET}`);
}
