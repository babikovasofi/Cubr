# Build: Друзья и подписки (slug: friends)

Plan: `swarm-report/friends-plan.md`. Branch `feat/friends` off `origin/main` (`36421ea`).
Exec agents: `python-fastapi` (backend, sonnet), `react-ts` (frontend, sonnet), in parallel;
`tester` (haiku) verified full Test plan coverage independently, added nothing (coverage
already complete). Orchestrator ran a final consolidated verification of both full command
lines after both exec agents committed.

## Backend (`python-fastapi`)

Files: `backend/app/models/friendship.py` (new), `backend/app/models/user.py`,
`backend/app/models/__init__.py`, `backend/app/schemas/friend.py` (new),
`backend/app/services/friends.py` (new), `backend/app/routers/friends.py` (new),
`backend/app/services/ratelimit.py` (`user_rate_limit`), `backend/app/services/auth.py`
(HANDLE_TAKEN pre-check + race-guard), `backend/app/config.py`, `backend/.env.example`,
`backend/app/main.py`, `backend/migrations/versions/0011_friendships.py` (new),
`backend/tests/conftest.py`, `backend/tests/test_friends.py` (new),
`backend/tests/test_profile_names.py`, `backend/tests/test_migrations.py` (new),
`.memory-bank/tasks/README.md` (Decision #4 known-tail line).

Commits: `648cda9` model+migration, `0b61c95` service+router+ratelimit, `057d686` auth.py fix,
`0be43a0` tests, `38dd1e9` memory-bank doc — each `Co-Authored-By: Claude Opus 5`.

Deviations from plan, with reason:
1. **Live Postgres `alembic upgrade head → downgrade -1 → upgrade head` (plan step 22) not
   run** — no Docker in this environment (same gap as stages 0007/0010). `alembic history`
   confirmed 0011 resolves cleanly as head off `0010_profile_showcase`. Needs a human/CI run
   against real Postgres before deploy; the migration's docstring carries the mandatory
   duplicate-handle SQL check to run first.
2. `test_friend_list_has_no_pii` reworked from the plan's literal wording: `send_request`
   requires the *requester* to already have their own `public_handle` set, so a handle-less
   sender can never reach the endpoint. The test instead makes both sides friends first, then
   has one side **clear** their handle (a legitimate, always-available action) to exercise the
   "Аноним" fallback in `GET /friends`.
3. Router originally crashed under async SQLAlchemy on implicit lazy-load of
   `Friendship.user_low`/`user_high` after `session.get()`/a fresh insert (not
   `selectinload`-ed) — fixed by having `send_request`/`accept` return `(Friendship, other_user)`
   tuples instead of relying on lazy relationship access in the router.
4. Two mypy-strict workarounds for fastapi-users' `TYPE_CHECKING`-only column stubs
   (`User.id`, `User.is_active` shadow the real mapped columns for the type checker):
   `User.__table__.c.id` (mirrors the existing pattern in `app/services/funnel.py` for
   `is_verified`), and the `is_active` check moved to instance-side.

## Frontend (`react-ts`)

Files: `frontend/src/api/friends.ts` (new), `frontend/src/friends/FriendsSection.tsx` (new),
`frontend/src/friends/useChallengeFriend.ts` (new), `frontend/src/duel/InvitePanel.tsx` (one
line), `frontend/src/pages/ProfilePage.tsx` (`<FriendsSection />` inserted between `CubeList`
and `BadgeGrid`), `frontend/src/api/client.ts` (`RU_BY_CODE`), `frontend/src/i18n/en.ts`,
`frontend/tests/api/friends.test.ts` (new), `frontend/tests/friends/FriendsSection.test.tsx`
(new).

Commit: `e0854a6` — `Co-Authored-By: Claude Opus 5`.

Deviations from plan, with reason:
1. `ProfilePage.test.tsx` was deliberately **not** modified — verified it stays green as-is:
   `FriendsSection`'s fetch-on-mount hits a relative URL through Node's built-in `fetch`, which
   throws synchronously and is caught into `ApiError(0, …)` by `request()`, degrading to the
   section's own error state rather than crashing into that pre-existing test's assertions.
2. Exact vertical placement of `<FriendsSection />` on `/profile` (between `CubeList` and
   `BadgeGrid`) wasn't pinned by the plan — a judgment call, not a deviation from a stated
   requirement.
3. Held the entry-chunk delta down by **reusing existing translated strings** wherever meaning
   matched (the 409 "already active duel" copy, "Удалить", "Повторить", "Отправляю…") instead
   of minting near-duplicate i18n keys — see Bundle budget below.

## Test coverage verification (`tester`, haiku)

Independently re-derived the plan's full Test plan checklist against what's actually in
`test_friends.py` / `test_profile_names.py` / `test_migrations.py` /
`FriendsSection.test.tsx` / `friends.test.ts` — every listed case present, nothing missing.
`tests_added: []`, `bugs_found: []`, `uncovered: []`.

## Full verification (orchestrator, consolidated re-run after both agents committed)

Backend:
```
cd backend && uv run pytest -q
469 passed, 1 skipped, 2 warnings in 37.35s
(skip = test_migrations.py::test_upgrade_downgrade_upgrade, no MIGRATION_TEST_DATABASE_URL, by design)

uv run ruff check .
All checks passed!

uv run ruff format --check .
107 files already formatted

uv run mypy app
Success: no issues found in 63 source files
```

Frontend:
```
cd frontend && npm test
Test Files  100 passed (100)
     Tests  1688 passed (1688)

npm run typecheck
(clean, no output)

npm run lint
(clean, no output)

npm run build
[check-bundle] входной чанк 314.0 kB / 320 kB — ок
(entry chunk 312.11 kB → 314.02 kB, +1.9 kB; ProfilePage chunk 32.35 kB — FriendsSection code
lives there, not in the entry chunk)

npx prettier --check "src/**/*.{ts,tsx,css}" "tests/**/*.{ts,tsx}" "scripts/*.mjs"
All matched files use Prettier code style!
```

## Bundle budget

Entry chunk grew 312.11 kB → 314.02 kB (+1.9 kB), ~6 kB headroom left under the 320 kB budget.
The growth is `i18n/en.ts` (statically imported, per plan step 21/Test-plan risk) — the growth
was minimized, not eliminated, by reusing existing translated strings instead of minting new
ones wherever the meaning already matched. `FriendsSection`/`useChallengeFriend` themselves add
zero entry-chunk weight — they live inside `ProfilePage`'s existing lazy chunk (32.35 kB).
Threshold was **not** raised.

## Decisions carried into the implementation (from the plan's Decisions section)

1. Friend-request response codes stay distinguishable (404 unknown handle / 409 duplicate
   pending / 409 already friends) — not unified into one opaque code. Mitigated by a
   **per-user** rate limit (`user_rate_limit`, keyed by `user.id`, not IP) —
   `test_friend_request_rate_limited_per_user` proves it survives IP rotation.
2. "Вызов в один клик" ships as a room-create + copy-link shortcut only — no persistent
   incoming-challenge/notification was built. `InvitePanel` now says explicitly: "Уведомление
   не придёт — отправь ссылку сам."
3. No separate friend-invite-link/token — `public_handle` is the only path to a friend request.
4. Orphaned-room lockout (`find_active_room` ignoring TTL/`open` status, no
   `DELETE /duel/rooms/{id}`) is **not fixed** here — recorded as a known pre-existing tail in
   `.memory-bank/tasks/README.md` ("Бэклог организационный"). Frontend mitigation: a 409 from
   `createRoom()` degrades to an offer to jump into the existing room instead of crashing.

## PR

Branch pushed: `feat/friends` → `origin/feat/friends`.
PR: https://github.com/babikovasofi/Cubr/pull/29 (against `main`). Not merged — waiting for
green CI, human merges.
