# Plan: tournament UI (weekly challenge)   (slug: tournament-ui)

Этап 5. Backend read-endpoint + frontend. All skeptic HIGH/MED applied. No unresolved blockers.
Framing: **«Челлендж недели»** — solve this week's shared scramble; recorded, honesty=pending, NO
standings yet (don't overpromise ranked competition — MED). Standings = later brick.

## TL;DR
Authed `/tournament` page reads state on mount via a NEW scramble-omitted `GET /tournament/current`,
shows a pre-commit gate (not played), a resume prompt (started, mid-window), or the finalized result
(valid/dnf). The scramble is revealed ONLY by `POST .../start` fired from an explicit commit click (П8).
The existing solo ritual is reused by parameterizing `useScramble` (fixed scramble) + `useSoloSession`
(result callback), then `POST .../submit` records the result.

## Acceptance criteria
### Backend (NEW read endpoint — resolves skeptic HIGH#1)
- `GET /tournament/current` authed (401 anon); **NEVER returns the scramble**; does NOT create a
  tournament or attempt row, does NOT start the deadline.
- Returns `{iso_year, iso_week, week_label, event, attempt_status: "started"|"valid"|"dnf"|null,
  time_ms|null, started_at|null, submitted_at|null, deadline_at|null}` where deadline_at =
  started_at + TOURNAMENT_ATTEMPT_WINDOW_SECONDS (for the UI countdown; null if not started).
- attempt_status null when the user has no attempt this week (tournament row may not exist yet).
- backend pytest green (extend test_tournament.py: anon 401; no-attempt→null; started→status+deadline,
  NO scramble in body; terminal→status+time, NO scramble; asserts GET creates no rows).

### Frontend
- Anon → ProtectedRoute redirect to `/login?next=/tournament`.
- On mount `GET /tournament/current` → render by attempt_status:
  - **null** → pre-commit card (week_label + «Челлендж недели» copy + П8 warning «раскроет скрамбл
    недели и потратит твою единственную попытку» + «Сделать попытку» → inline two-step confirm).
  - **started** → resume card (window countdown to deadline_at + «Продолжить» → POST start, idempotent,
    returns same attempt+scramble → active ritual).
  - **valid|dnf** → `<TournamentResult>` terminal (no start call, scramble never fetched).
- Commit/resume → `POST .../start` → scramble revealed → solo ritual runs against that FIXED server
  scramble (no client generation, no local re-roll fallback, no regenerate).
- Ritual result → `POST .../submit {time_ms>0, status valid|dnf}` fires exactly once. Server status
  wins; if submitted "valid" but got "dnf" → explicit «окно попытки истекло → DNF» outcome (MED).
- `POST start` failure → error+retry; ritual CANNOT proceed, NO local-scramble fallback.
- submit **401** (token expired mid-ritual) → keep result in memory, prompt re-auth, retry same time_ms
  while window open; window closed → forced-DNF explanation (MED). submit **409** → recover via GET/start,
  show terminal (result preserved). submit network fail → retryable, result not lost.
- honesty never displayed. DNF/loss card is QUIET (surface-2 + ink, no red slab, no re-roll CTA —
  design-system §1/§6.3). Solo `/solo` + `/solves` save UNCHANGED (regression-free).
- frontend vitest green; tsc + lint clean.

## Plan
### Backend (python-fastapi)
- `schemas/tournament.py`: add `TournamentCurrentRead` (fields above, NO scramble).
- `services/tournament.py`: `get_current_attempt(session, user_id) -> (tournament|None, attempt|None)`
  read-only (SELECT current-week tournament; if exists SELECT this user's attempt); NO creates.
- `routers/tournament.py`: `GET /tournament/current` authed → build TournamentCurrentRead (deadline_at
  from started_at + settings window). No scramble field on this schema at all.
- `tests/test_tournament.py`: extend per acceptance.

### Frontend (react-ts) — reuse via parameterization (skeptic HIGH#2), NOT fork
- `api/tournament.ts` NEW — types + `getCurrent()`, `startAttempt()`, `submitAttempt(body)` over `request()`.
- `scramble/hooks/useScramble.ts` — `useScramble(opts?: {fixed?: string})`: when `fixed`, SKIP fetch +
  SKIP localFallback, set scramble=fixed, moves=parseMoves, expectedFacelets=scrambleToFacelets(fixed),
  scrambleToken=null, loading=false; `regenerate()` no-op. Non-fixed path byte-identical.
- `solo/useSoloSession.ts` — `useSoloSession(opts?: {fixedScramble?, onResult?, disableSoloSave?})`:
  pass `{fixed}` to useScramble; in the result effect, if onResult → skip buildSolvePayload/createSolve/
  saveState, call onResult once (reuse the existing one-shot `savedRef` guard for BOTH branches — avoid
  double-submit). `again()`'s regenerate gated solo-only. Solo callers pass no opts → identical.
- `solo/SolveRitual.tsx` NEW — presentational extraction of the shared ritual JSX from SoloPage
  (loading→solve_verify + Calibrate/Verify/Status/SolveVerify panels + ScrambleWalkthrough). **Preserve
  the exact hidden-vs-unmount structure + its comment** (prior bug: unmount killed the video stream). The
  `result` phase stays owned by each page. SoloPage refactored to consume it (pure refactor, ResultScreen unchanged).
- `tournament/useTournamentAttempt.ts` NEW — state machine `idle→loading→precommit|resume|terminal`,
  `committing→active|commit_error`, `submitting→terminal|submit_error`. Mount: getCurrent(). commit/resume:
  startAttempt. submit: submitAttempt (409→getCurrent recover; 401→re-auth+retry-in-window; net→retry).
- `tournament/TournamentResult.tsx` NEW — terminal panel (week_label, time via Timer success / DNF via
  Timer dnf, forced-late-DNF note). Quiet loss styling, no «Ещё раз». honesty hidden.
- `pages/TournamentPage.tsx` NEW — composes the machine + `<SolveRitual>` with
  `useSoloSession({fixedScramble: attempt.scramble, disableSoloSave:true, onResult: submit})`; window
  countdown during ritual; error/retry states.
- `App.tsx` — `/tournament` under `<ProtectedRoute>`. `pages/HomePage.tsx` — «Челлендж недели» nav card.

## Tests
Backend: GET anon 401; no-attempt→null+no rows; started→status+deadline_at+NO scramble; terminal→time+NO
scramble. Frontend: api/tournament (paths + ApiError); useScramble fixed mode (no fetch/fallback,
regenerate no-op); useTournamentAttempt (idle no-call until getCurrent; commit→active; terminal skip
ritual; submit valid/dnf; 409 recover; 401 retry; net retry); TournamentPage RTL (precommit hides
scramble + two-step confirm calls start once; terminal-on-load renders result; late-DNF note; resume
countdown). Regression: solo tests green after SolveRitual extraction + useSoloSession opts.

## Blockers
None. Skeptic HIGH#1 resolved by adding the scramble-omitted GET; HIGH#2 by hook parameterization; MEDs folded in.

## Out of scope
Leaderboard/standings/cups/week-countdown table; honesty verification/frames; realtime abandon-DNF (Этап 4);
Ao5/event selection; a public (unauthed) tournament endpoint (must never exist with a scramble).

## Assumptions
- Client base is `/api`; routes `/api/tournament/current` (GET), `/current/attempt/{start,submit}` (POST), cookie-authed.
- Reuse = inject fixed scramble + result callback; tournament does NOT reuse solo ResultScreen or /solves save.
- Ritual DNF → submit status "dnf", time_ms = Math.max(1, round(elapsedMs)).
- Pre-commit week label from the GET (authoritative), not computed client-side.
- No Modal component exists → inline two-step danger-confirm reusing Button.
