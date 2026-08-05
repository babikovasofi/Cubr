# Build: tournament participation board (de-ranked)

Plan: [tournament-leaderboard-plan.md](tournament-leaderboard-plan.md). Decisions: de-ranked board + explicit public-handle opt-in. Backend (python-fastapi/sonnet) + frontend (react-ts/sonnet) exec, tests authored+run by **haiku** (new flow).

## Backend (sonnet) — complete
- `models/user.py` — `public_handle` String(64) nullable.
- `migrations/versions/0006_user_public_handle.py` — down_revision `0005_tournaments`. **Verified upgrade→downgrade→upgrade against LIVE Postgres** (cubr@localhost:5432), column `character varying(64)` nullable, DB left at head.
- `schemas/user.py` — `public_handle` on UserRead + UserUpdate (trim + ""→None via before-validator, `max_length=64` → 422 over-length).
- `schemas/tournament.py` — `StandingEntry(display_name, time_ms, is_self)` (NO rank, NO email), `TournamentStandingsRead`.
- `services/tournament.py` — `display_name_for(public_handle) → public_handle or "Аноним"` (single chokepoint); `get_current_standings` selects ONLY `User.public_handle` (never email/nickname), WHERE status=="valid" ORDER BY submitted_at ASC, id ASC; separate valid/dnf counts; your_entry; is_self.
- `routers/tournament.py` — authed rate-limited `GET /tournament/current/standings`, `limit` `Query(gt=0)` clamped to MAX=200 (≤0 → 422); read-only, no scramble.
- `config.py` — `TOURNAMENT_STANDINGS_LIMIT_DEFAULT=50`, `_MAX=200`.

## Frontend (sonnet) — complete
- `api/tournament.ts` — `StandingEntry`/`TournamentStandingsRead` (no rank/email), `getStandings(limit?)`.
- `api/auth.ts` — `public_handle` on UserRead + UserUpdate.
- `tournament/useTournamentStandings.ts` NEW — mount-fetch hook + reload.
- `tournament/TournamentStandings.tsx` NEW — de-ranked list (NO № rendered), disclaimer «Время участники засекают сами — дружеский зачёт, не рейтинг», empty state, DNF count (RU plural), is_self 2px-primary row + «ты», your_entry «Твоё место» row, loading/error+retry. Props = display_name only (email/nickname unreachable).
- `pages/TournamentPage.tsx` — renders board in ALL phases; attempt machine untouched.
- `pages/ProfilePage.tsx` — «Публичное имя в турнире» input → PATCH /users/me, notice «Это имя увидят другие… пусто → «Аноним»».

## Tests (haiku authored + ran)
Backend `tests/test_tournament.py` +13: anon-401, empty-board, valid-ordered-by-submitted_at, excludes-dnf+started, only-dnf, no-rank-field, no-email-no-nickname-leak, public_handle-shown, no-scramble-in-body, limit-clamped, display_name_for-unit, set-public_handle-via-PATCH, not-leaked-to-others.
Frontend +19: api getStandings (path/limit/ApiError); useTournamentStandings NEW (mount/empty/error-reload/abort); TournamentStandings NEW RTL (de-ranked no-№, is_self marker, empty, DNF, disclaimer, NO "@" privacy guard, your_entry, loading/error, time format).

```
backend: uv run pytest -q → 37 in test_tournament (full suite green), ruff + mypy clean
frontend: npm run typecheck clean · npx vitest run → 245 passed (28 files) · npm run lint clean
```
No bugs surfaced.

## Privacy (П10)
Standings query + schema select ONLY `public_handle` (or "Аноним") — email + nickname never touched. De-ranked (no rank/position field). Explicit opt-in: unset handle → "Аноним". Verified by no-leak tests (backend body + frontend no-"@").

## Live
Migration 0006 already applied to the running local Postgres (DB at head). Backend :8000 + frontend :5173 still up — the board is testable live once a user sets a public handle + submits a valid attempt.
