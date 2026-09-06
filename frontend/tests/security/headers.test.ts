// Guards the security headers the site answers with.
//
// Two front doors serve the same bundle — Caddy in production, `vite preview` on
// the local ZAP stand — and both read deploy/security-headers.json. The Caddy half
// goes through a generated file, which is exactly the kind of artefact that goes
// stale silently: someone edits the JSON, forgets the generator, and the stand
// then scans a site that no longer matches production. These tests fail instead.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

import spec from "../../../deploy/security-headers.json";
import { render } from "../../../deploy/scripts/gen-security-headers.mjs";

const deployDir = join(dirname(fileURLToPath(import.meta.url)), "../../../deploy");
const generated = readFileSync(join(deployDir, "security-headers.caddy"), "utf8");

describe("security headers", () => {
  it("security-headers.caddy matches the JSON source", () => {
    expect(generated).toBe(render(spec));
  });

  it("ships every common header to Caddy", () => {
    for (const [name, value] of Object.entries(spec.common)) {
      expect(generated).toContain(`${name} "${value}"`);
    }
  });

  it("keeps HSTS out of the common set", () => {
    // The local stand is plain http; an HSTS header there would pin 127.0.0.1 to
    // TLS in the tester's browser and break every other localhost app they run.
    expect(Object.keys(spec.common)).not.toContain("Strict-Transport-Security");
    expect(spec.httpsOnly["Strict-Transport-Security"]).toMatch(/max-age=\d+/);
  });

  const csp = spec.common["Content-Security-Policy"];

  it("allows the runtime CDNs the app actually loads", () => {
    // Runtime network dependencies, not bundled: cubing.net ships the scramble
    // solver as module workers (src/scramble/cubingCdn.ts), jsdelivr the MediaPipe
    // wasm and googleapis the hand model (src/vision/hooks/useHands.ts). A CSP
    // that forgets one of these breaks scrambles or the camera judge in production
    // while every test still passes.
    expect(csp).toContain(
      "script-src 'self' 'wasm-unsafe-eval' blob: https://cdn.cubing.net https://cdn.jsdelivr.net",
    );
    expect(csp).toMatch(/worker-src[^;]*blob:/);
    expect(csp).toMatch(/worker-src[^;]*https:\/\/cdn\.cubing\.net/);
    expect(csp).toMatch(/connect-src[^;]*https:\/\/storage\.googleapis\.com/);
    // index.css @imports the Google font stylesheet, which then pulls gstatic.
    expect(csp).toMatch(/style-src[^;]*https:\/\/fonts\.googleapis\.com/);
    expect(csp).toMatch(/font-src[^;]*https:\/\/fonts\.gstatic\.com/);
  });

  it("locks down the directives an XSS would otherwise abuse", () => {
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("form-action 'self'");
    // 'unsafe-eval' and a wildcard script source would make the rest pointless.
    expect(csp).not.toMatch(/script-src[^;]*'unsafe-eval'/);
    expect(csp).not.toMatch(/script-src[^;]*[ ]\*/);
    expect(csp).not.toMatch(/script-src[^;]*'unsafe-inline'/);
  });
});
