# Build: scramble-persistence

Plan: [scramble-persistence-plan.md](scramble-persistence-plan.md). Strategy: signed HMAC token (no DB write on GET, lazy-persist on solve).

## Backend (python-fastapi, sonnet) — complete
Changed:
- `app/services/scramble_token.py` NEW — HMAC-SHA256 sign/verify, base64url, `VerifiedScramble` dataclass, `ScrambleTokenError`.
- `app/config.py` — `SCRAMBLE_SIGN_SECRET` fail-closed (min32 + placeholder-reject), `SCRAMBLE_TOKEN_TTL=3600`.
- `app/models/scramble.py` NEW — GUID pk, event, scramble, `nonce` UNIQUE+index, created_at. Registered in `models/__init__.py`.
- `app/models/solve.py` — `scramble_id` GUID FK `scrambles.id` ondelete SET NULL, nullable, indexed.
- `app/schemas/scramble.py` — `ScrambleOut.scramble_token`. `app/schemas/solve.py` — `SolveCreate.scramble_token` explicit (`extra="forbid"` KEPT), `SolveRead.scramble_id`.
- `app/routers/scramble.py` — signs token, no session dep, no write. `app/routers/solves.py` — verify (422 bad/expired), 409 reused nonce (SELECT + IntegrityError race guard), lazy-persist row, server-authoritative scramble string from verified token.
- `migrations/versions/0004_scrambles.py` NEW — down_revision `0003_cubes`, mirrors 0003 GUID/UUID pattern.
- Tests: `test_scramble.py` + `test_solves.py` extended; `conftest.py` (SCRAMBLE_SIGN_SECRET default + Scramble table in sqlite metadata); `.env.example` documented.

API changes (cross-layer):
- GET /scramble → `{scramble, event, scramble_token}` (scramble_token new, required).
- POST /solves accepts optional `scramble_token`. Valid → 201, solve.scramble set from verified token (client `scramble` ignored), scramble_id populated. Omitted → 201 null. Bad/expired sig → 422. Reused nonce → 409.
- SolveRead includes `scramble_id`.

Tests (real):
```
uv run pytest -q            → 65 passed in 3.82s
uv run ruff check .         → All checks passed!
uv run ruff format --check  → 13 files already formatted
uv run mypy <scope 9 files> → Success: no issues found
```
Note: repo-wide `mypy .` has 9 PRE-EXISTING errors (SQLAlchemy-stub `.__table__` typing quirk in test files) — verified predate this change, no new-file/edited-line contribution.

## Frontend (react-ts, sonnet) — complete
Changed:
- `src/api/scramble.ts` — `ScrambleOut.scramble_token`; `fetchScramble` resolves the object.
- `src/scramble/hooks/useScramble.ts` — `scrambleToken: string|null` in ScrambleData/state; set from fetch; reset null every effect run (covers local fallback + regenerate, no stale-token leak).
- `src/api/solves.ts` — `SolveCreate.scramble_token?`, `SolveRead.scramble_id`.
- `src/solo/solveSave.ts` — `buildSolvePayload` new `scrambleToken` param → `scramble_token` in payload; stale comment fixed.
- `src/solo/useSoloSession.ts` — passes `scramble.scrambleToken`, added to effect deps.
- Tests: `useScramble.test.ts` + `solveSave.test.ts` extended (token exposed happy/retry, null on fallback, clears on regenerate).

Tests (real):
```
npm run typecheck (tsc --noEmit) → clean
npx vitest run                   → 21 files, 194 passed
npm run lint (eslint .)          → clean, exit 0
```
`useAccuracySession` also consumes useScramble but reads only `.scramble/.moves` — unaffected.

## Cross-layer note
Contract pinned in plan, both sides used same field names (`scramble_token` on wire, `scramble_id` read-back). No integration mismatch.

## Deferred / live-only
- `alembic upgrade head` for 0004 against real Postgres (no Docker in env) — same caveat as 0003.
- End-to-end /scramble → solo → save with a live linked id.
