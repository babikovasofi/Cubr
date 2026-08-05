// Server-generated scramble string. Mirrors backend/app/schemas/scramble.py.
// Public GET, no auth — rate-limited server-side (services/ratelimit.py).
//
// `scramble_token` is a signed, one-time token (HMAC over the scramble + a
// nonce + expiry) that must be threaded back on POST /solves so the server
// can lazily persist the scramble row and link solve.scramble_id to it. It
// carries no meaning client-side — just forward it opaquely.

import { request } from "./client";

export interface ScrambleOut {
  scramble: string;
  event: string;
  scramble_token: string;
}

export function fetchScramble(signal?: AbortSignal): Promise<ScrambleOut> {
  return request<ScrambleOut>("/scramble", { signal });
}
