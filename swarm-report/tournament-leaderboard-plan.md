# Plan: weekly tournament participation board   (slug: tournament-leaderboard)

Decisions locked: **de-ranked participation board** (B1) + **explicit public-handle opt-in** (B2).
No unresolved blockers. Skeptic HIGH#1/#3 killed by de-ranking; HIGH#2 by the opt-in handle.

## TL;DR
Authed, read-only current-ISO-week board of `status=="valid"` completers, ordered by `submitted_at`
(**no rank numbers, no #1**), each shown by a deliberately-set **public_handle** (never email, never the
email-derived nickname; unset → "Аноним"). Shows counts ("N куберов прошли челлендж недели"), the viewer's
own time personally, an unverified-self-timed disclaimer. New nullable `User.public_handle` (migration 0006)
set via `PATCH /users/me` from a profile field carrying a "это имя увидят другие" notice. True ranking waits
for the honesty brick (recorded gate).

## Acceptance criteria
Backend:
- `User.public_handle` String(64) nullable; migration 0006 (down_revision `0005_tournaments`); settable via
  `PATCH /users/me` (added to UserUpdate) and readable on `GET /users/me` (UserRead) — length ≤64, trimmed;
  empty string → stored NULL.
- `GET /tournament/current/standings` authed (401 anon); read-only (creates nothing, no clock); response has
  **NO scramble, NO email, NO nickname, NO rank/position field**.
- Returns current-week valid completers ordered by `submitted_at ASC, id ASC`, each `{display_name, time_ms,
  is_self}` where `display_name = public_handle or "Аноним"`; plus `valid_count`, `dnf_count`, `your_entry`
  (viewer's own, or null). Absent/empty tournament → 200 with empties, not 500. `started` excluded from all;
  `dnf` excluded from entries but in `dnf_count`. Not filtered on honesty; never labeled verified.
- `limit` clamped to `TOURNAMENT_STANDINGS_LIMIT_MAX`.
Frontend:
- `/tournament` renders a participation section in ALL phases (independent fetch): de-ranked rows, empty state,
  DNF count, unverified disclaimer, viewer row marked. No rank numbers rendered.
- Profile page: a "Публичное имя в турнире" field (set/clear public_handle via PATCH /users/me) with a notice
  that it's visible to others; unset shows the board as "Аноним".
- Solo + existing attempt flows unchanged.
- backend pytest/ruff/mypy green; frontend vitest/tsc/lint green.

## Plan — files
Backend:
- `models/user.py`: add `public_handle: Mapped[str | None]` String(64) nullable.
- `migrations/versions/0006_user_public_handle.py`: down_revision `0005_tournaments`; add column; downgrade drops.
- `schemas/user.py`: add `public_handle: str | None` to UserRead + UserUpdate (validate ≤64, trim, ""→None).
- `schemas/tournament.py`: `StandingEntry(display_name:str, time_ms:int, is_self:bool)` (NO rank/email),
  `TournamentStandingsRead(iso_year, iso_week, week_label, event, entries, your_entry, valid_count, dnf_count)`.
- `services/tournament.py`: `display_name_for(public_handle) -> public_handle or "Аноним"`; `get_current_standings(
  session, viewer_id, limit)` — SELECT current-week tournament (None→empty); JOIN attempts→user selecting
  `public_handle` ONLY (never email/nickname), WHERE status=="valid", ORDER BY submitted_at ASC, id ASC, LIMIT;
  separate COUNT(valid)/COUNT(dnf); your_entry = viewer's valid attempt (or null); is_self by user_id==viewer_id.
- `routers/tournament.py`: authed rate-limited `GET /current/standings`; clamp limit; docstring: read-only, no scramble.
- `config.py`: `TOURNAMENT_STANDINGS_LIMIT_DEFAULT=50`, `TOURNAMENT_STANDINGS_LIMIT_MAX=200`.
Frontend:
- `api/tournament.ts`: `StandingEntry`/`TournamentStandingsRead` types (no rank/email), `getStandings(limit?)`.
- `api/auth.ts` (or existing user-update path): support `public_handle` in the profile update call.
- `tournament/useTournamentStandings.ts` NEW: {data, loading, error, reload}, mount fetch.
- `tournament/TournamentStandings.tsx` NEW: de-ranked list (no № shown), disclaimer, empty state, DNF count,
  your-row marker, loading/error+retry. Receives only display_name (no email/nickname).
- `pages/TournamentPage.tsx`: render `<TournamentStandings>` in all phases.
- `pages/ProfilePage.tsx` (or existing profile): "Публичное имя в турнире" input + public notice, PATCH /users/me.

## Test plan (mandatory — haiku authors these)
Backend `tests/test_tournament.py` + `tests/test_auth.py`/user tests:
- `test_standings_anonymous_401`.
- `test_standings_empty_board` — no tournament → 200, entries [], counts 0, your_entry null.
- `test_standings_valid_ordered_by_submitted_at` — 3 valid (inject distinct submitted_at) → all present in submit order; is_self only caller.
- `test_standings_excludes_dnf_and_started` — dnf in dnf_count only; started in neither; valid present.
- `test_standings_only_dnf` — all dnf → entries [], dnf_count N.
- `test_standings_no_rank_field` — response has no rank/position key.
- `test_standings_no_email_no_nickname_leak` — user email "leaky@example.com", nickname "Leaky", public_handle=None → body contains none of those, no "@"; display_name == "Аноним".
- `test_standings_public_handle_shown` — public_handle "SpeedCuber" → display_name "SpeedCuber".
- `test_standings_no_scramble_in_body` — DB scramble string absent from response (П8).
- `test_standings_limit_clamped` — limit>MAX clamped; limit<=0 sane.
- `test_display_name_for_unit` — handle→handle; None→"Аноним"; never email/nickname.
- `test_set_public_handle_via_patch_me` — PATCH /users/me {public_handle:"X"} → GET /users/me shows it; ""→null; >64 rejected 422.
- `test_public_handle_not_leaked_to_others` — GET /users/me never exposes another user (unchanged), and standings uses handle not email.
Frontend:
- `tests/tournament/api.test.ts` (extend): getStandings path + limit + ApiError.
- `tests/tournament/useTournamentStandings.test.ts` NEW: mount fetch; empty ok; error→reload recovers.
- `tests/tournament/TournamentStandings.test.tsx` NEW (RTL): de-ranked rows (assert NO rank number rendered); is_self marker; empty copy; DNF line; disclaimer present; NO "@" anywhere; your-entry row.
- `tests/tournament/TournamentPage.test.tsx` (extend): standings in precommit + terminal; attempt assertions unregressed.
- profile test: public_handle field sets via PATCH; public notice rendered.

## Out of scope
Honesty verification / "verified" / true ranking / cups / points; finalize-cron; historical/past-week boards;
public (unauthed) board; avatars; realtime WS; handle moderation/uniqueness (word-filter = V2, R9).

## Assumptions
- public_handle NOT unique, NOT moderated (V2); ≤64 chars; opt-in only (unset → "Аноним"). Never email/nickname on the wire.
- Current ISO week only. Small population → top-N + counts, no keyset pagination. Client base `/api`, cookie auth.
