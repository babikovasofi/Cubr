# Plan: weekly-tournament foundation   (slug: weekly-tournament)   — SUPERSEDED / folded

## Verdict: skeptic = block(scramble) + revise(scope). Not built as a standalone brick.

## Findings
- **HIGH#1 — П8 anti-cheat regression.** Returning the weekly scramble from a public
  `GET /tournament/current` is the exact cheat §П8.1/§П5.4/R7 forbid (fetch Monday's scramble,
  grind offline all week, then submit). **Scramble must NOT be served from an unauthenticated GET** —
  it is revealed only by the attempt-start endpoint AFTER `attempt(status=started)` is recorded.
- **HIGH#2 — too-narrow = YAGNI.** With the scramble withheld, the deliverable is a `tournaments`
  table + a GET returning ISO-week id + label — both pure-computable from the date, zero persistence
  value. The row only earns its keep as the FK target of `unique(user_id, tournament_id)` (П8.2) and
  as the persisted source-of-truth for the scramble reveal — **both of which live in the attempt brick.**

## Decision → fold into the attempt brick
Do NOT stand up the tournaments table a brick early. The correct first REAL tournament brick creates
the tournament row lazily (get-or-create) the first time a player STARTS an attempt, persists that
week's scramble then, records the attempt under the unique constraint, and reveals the scramble only
in that authenticated response. Superseded by → **`tournament-attempt`**.

## Salvaged design decisions (carry into tournament-attempt)
- New `tournaments` table (NOT reuse of `scrambles` — its `nonce UNIQUE` = one-time-use solo tokens,
  opposite of a shared weekly scramble). Portable **GUID** id + `iso_year`/`iso_week` Integers.
- **Idempotency = UNIQUE(iso_year, iso_week) + IntegrityError→re-SELECT** (same race pattern as the
  scramble-persistence nonce). NOT "deterministic" — `random_scramble()` is `secrets.choice`; the
  invariant is the persisted row is the sole source of truth, generated once, never re-rolled for an
  existing week.
- **ISO-week correctness:** key strictly on `datetime.now(timezone.utc).isocalendar()[:2]`; iso_year ≠
  calendar year at Dec/Jan boundary; test a 53-week year (2026) + a Dec-31/Jan-1 crossover. Week label
  = ISO-8601 `"YYYY-Www"` zero-padded. Same UTC computation must be reused by the future finalize-cron.
- Migration down_revision `0004_scrambles`; portable types; hand-written (no live PG), verify on Postgres before deploy.
- `solves.tournament_id` already exists as a plain nullable UUID (no FK) — the attempt brick decides the FK.

## Out of scope (still) / deferred
Leaderboard/results, cup awards, finalize-cron (П8.4), duel scramble sharing.
