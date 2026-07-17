# Build: tournament-ui (weekly challenge)

Plan: [tournament-ui-plan.md](tournament-ui-plan.md). Backend read-endpoint (python-fastapi) + frontend (react-ts), sonnet.

## Backend — complete
- `schemas/tournament.py` — `AttemptStatus` literal + `TournamentCurrentRead` (NO scramble field).
- `services/tournament.py` — `get_current_attempt(session, user_id, now=None)` read-only (SELECT tournament→None if absent, SELECT attempt only if tournament exists); no writes. `_EVENT`→public `EVENT`.
- `routers/tournament.py` — `GET /tournament/current` authed (401 anon); `deadline_at = started_at + TOURNAMENT_ATTEMPT_WINDOW_SECONDS` or null; `attempt.status` narrowed to AttemptStatus via cast.
- Contract: `{iso_year, iso_week, week_label, event, attempt_status: started|valid|dnf|null, time_ms, started_at, submitted_at, deadline_at}`. Never returns scramble, creates nothing.
- Tests: anon 401; no-attempt→all-null + zero rows created; started→status+deadline_at+`"scramble" not in body`+rows unchanged; terminal→time_ms+no scramble.

```
pytest tests/test_tournament.py -q → 24 passed
pytest -q (full)                   → 89 passed
ruff check / format (4 files)      → clean
mypy app                           → Success, 33 files
```

## Frontend — complete
New: `api/tournament.ts` (getCurrent/startAttempt/submitAttempt), `solo/SolveRitual.tsx` (extracted shared ritual, hidden-vs-unmount + comment preserved), `tournament/useTournamentAttempt.ts` (state machine: loading→precommit|resume|terminal, committing→active|commit_error, submitting→terminal|submit_error; 409 recover, 401 keep+retry-in-window, network retry, forcedLateDnf detect), `tournament/TournamentResult.tsx` (quiet loss, no re-roll, honesty hidden), `pages/TournamentPage.tsx` (ActiveRitual mounted only AFTER commit → useScramble/useSoloSession never exist pre-commit = П8 enforced structurally, not just UI-gated).
Modified: `useScramble.ts` (+`opts.fixed`; skip fetch/fallback, regenerate no-op; non-fixed byte-identical), `useSoloSession.ts` (+`fixedScramble/onResult/disableSoloSave`; savedRef one-shot covers both branches; again() skips regenerate when fixed), `SoloPage.tsx` (pure refactor → SolveRitual+ResultScreen), `Button.tsx` (+variant primary/secondary/danger, additive, default unchanged), `App.tsx` (/tournament under ProtectedRoute), `HomePage.tsx` («Челлендж недели» card), `vite.config.ts` (test glob +*.tsx).

Skeptic HIGH/MED applied: HIGH#1 scramble-omitted GET drives mount state (no start-on-mount leak); HIGH#2 hook parameterization not fork; MED deadline countdown + forced-DNF note; MED submit 401 keep+retry; MED «Челлендж недели» framing (no fake standings); LOW quiet DNF card.

```
tsc --noEmit   → clean
eslint .       → clean
vitest run     → 24 files, 220 passed (194 pre-existing no-regression + 26 new)
```

## Cross-layer
Both sides followed the pinned `TournamentCurrentRead` contract; field names match, no integration mismatch.

## Deferred / live-only (needs running backend + Postgres — next step: raise Docker)
- qa-smoke live click-through (start→ritual→submit, resume, terminal, forced-DNF) — not runnable headless without a live backend+DB+camera.
- `alembic upgrade head` (0004/0005) against Postgres.
