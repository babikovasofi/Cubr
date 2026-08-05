# Plan: Persist server-generated scrambles + link each solve to its scramble   (slug: scramble-persistence)

First honesty-link brick of Этап 3. П5/П8: «скрамбл только от сервера».
**B1 resolved → signed-token strategy (user pick).**

## TL;DR
GET /scramble returns the scramble plus an **HMAC-signed token** (no DB write — stateless,
zero growth/DoS). POST /solves verifies the token (tamper-evident scramble string + one-time
nonce), **lazily persists** the scramble row only for a real solve, and links `solve.scramble_id`
to it. Offline/anon local-fallback carries no token → scramble_id NULL, ritual still saves.

## Acceptance criteria
- GET /scramble returns `{scramble, event, scramble_token}`; token = `HMAC(scramble|event|nonce|exp)`
  signed with `SCRAMBLE_SIGN_SECRET`. **No DB write on GET.**
- POST /solves accepts an **explicit optional** `scramble_token` (SolveCreate KEEPS `extra="forbid"`).
  - Valid token → server persists a `scrambles` row (lazy, real-solve only), sets `solve.scramble_id`,
    and the **stored scramble string comes from the signed token** (server authoritative, client
    `scramble` text cannot lie).
  - Bad/expired signature → 422. Reused nonce (already consumed) → 409. Omitted → 201, scramble_id NULL.
  - Junk/misspelled extra key still → 422 (forbid enforced — skeptic HIGH#1).
- Migration 0004 (down_revision `0003_cubes`): `scrambles` (id GUID pk, event, scramble, **nonce UNIQUE**,
  created_at) + `solves.scramble_id` nullable FK (GUID, ondelete SET NULL, indexed). `downgrade` reverses.
- `SCRAMBLE_SIGN_SECRET` fail-closed (reject placeholder + min-length), mirroring the auth-secret pattern (Этап 2.2).
- Frontend threads `scramble_token` from /scramble to POST /solves; local `randomScramble()` fallback +
  regenerate → token=null; solo ritual still saves.
- backend pytest + frontend vitest green; tsc/ruff/mypy clean.

## Plan
Backend:
- **Token util** `services/scramble_token.py`: `sign(scramble, event) -> token` (embeds random nonce +
  exp) and `verify(token) -> {scramble, event, nonce}` raising on bad sig / expiry. HMAC-SHA256 over a
  canonical payload; base64url. Reuse config secret loader.
- **config.py**: add `SCRAMBLE_SIGN_SECRET` with the existing fail-closed validation (reject placeholder,
  min 32 chars) — same guard as `SECRET`/`RESET_VERIFY_SECRET`. Generous default `SCRAMBLE_TOKEN_TTL`
  (e.g. 3600s; note it's a solo-window, tune later).
- **models/scramble.py** NEW: `Scramble` on `Base` — GUID pk (portable, sqlite-testable), `event str(16)
  default "333"`, `scramble str(512)`, `nonce str` UNIQUE (one-time-use), `created_at` server_default now().
  No user_id (anonymous issuance). Register in `models/__init__.py`.
- **models/solve.py**: `scramble_id: Mapped[uuid.UUID | None]` = GUID FK `scrambles.id` ondelete SET NULL,
  nullable, indexed — mirror `cube_id` precedent exactly.
- **schemas/scramble.py**: `ScrambleOut` gains `scramble_token: str`.
- **schemas/solve.py**: `SolveCreate` adds explicit `scramble_token: str | None = None`, **keeps
  `extra="forbid"`**; `SolveRead` adds `scramble_id: UUID | None`.
- **routers/scramble.py**: after generating, `sign(...)`; return `ScrambleOut(scramble, event, scramble_token)`.
  Stays public + 60/min rate-limit; **no session dependency, no write**.
- **routers/solves.py**: if `payload.scramble_token`: `verify()` (bad → 422); look up existing scramble by
  nonce — if present → 409 (consumed); else insert `Scramble(scramble=verified.scramble, event, nonce)` and
  set `solve.scramble_id = row.id`. Use the **verified** scramble string as authoritative.
- **Migration 0004**: hand-written, mirror 0003 GUID/UUID precedent; unique index on nonce; ix on
  solves.scramble_id. Header: verify `alembic upgrade head` on Postgres before deploy.

Frontend:
- `api/scramble.ts`: `ScrambleOut` gains `scramble_token: string`; `fetchScramble` resolves the object.
- `useScramble.ts`: carry `scrambleToken: string | null` in ScrambleData; null on fallback + regenerate.
- `api/solves.ts`: `SolveCreate` gains `scramble_token?: string | null`; `SolveRead` gains `scramble_id`.
- `solveSave.ts`: `buildSolvePayload` new `scrambleToken: string | null = null` param → `scramble_token`
  in payload. Update stale HIGH#4 comment.
- `useSoloSession.ts`: pass `scramble.scrambleToken` into buildSolvePayload; add to that effect's deps.

Tests:
- backend: GET returns a verifiable token, no scrambles row written. POST with a valid token → 201, row
  persisted, solve.scramble_id set, stored scramble == signed scramble. Tampered token → 422. Reused
  token/nonce → 409. Omitted → 201 null. `{scramble_token, bogus}` → 422. `verify(sign(x)) == x`; expired → raise.
- frontend: useScramble exposes scrambleToken (null on fallback + regenerate); buildSolvePayload carries
  scramble_token (null when omitted); fetch mock resolves the object.

## Blockers
None. B1 resolved (signed token). Real solve↔scramble binding beyond text/one-time-use (frame re-read,
timestamps) = later Этап 3 bricks (out of scope, noted below).

## Out of scope
- solve↔scramble frame/timestamp event-stream validation, OpenCV re-check, `solve.status` (rest of Этап 3).
- WCA random-STATE, duel/tournament scramble sharing, scramble dedup, Redis multi-worker rate limit,
  backfilling scramble_id onto existing solves, token revocation lists.

## Assumptions
- scramble_id NULLABLE on solve (offline/anon local-fallback has no token; must still save).
- Token TTL is a generous solo-window (default 3600s); a solve started long after fetch may 422 → user
  re-scrambles. Acceptable for MVP.
- Nonce uniqueness enforces one-time-use at the DB layer (concurrent double-submit → one 201, one 409).
- `SCRAMBLE_SIGN_SECRET` distinct from auth `SECRET` (separate blast radius), fail-closed everywhere.
