# Architecture decisions

Running log of load-bearing technical decisions.

## Stage 2.1 — backend scaffold

- **Async SQLAlchemy 2.0 + asyncpg + Alembic async env.** DB access is async end-to-end
  (`create_async_engine`, `async_sessionmaker`, one `AsyncSession` per request via
  `Depends(get_session)`). Alembic `env.py` runs migrations through an `AsyncEngine` +
  `connection.run_sync(...)` under `asyncio.run`.
- **UUID primary keys** for `user` and `solves` (compatible with fastapi-users and future
  Google OAuth accounts table).
- **`solves.status` is a plain `VARCHAR` with app-level validation** (`valid|dnf|rejected`),
  not a DB enum — avoids migration churn when statuses change.
- **Package manager: `uv`** (not poetry). `uv.lock` is committed.
- **`User` inherits the fastapi-users base now** (`SQLAlchemyBaseUserTableUUID`) in 2.1,
  even though auth ships in 2.2 — so the auth stage does not have to rewrite the table.
  App columns (`nickname`, `avatar_url`, `cups`, `best_single_ms`, `best_ao5_ms`,
  `created_at`) are layered on top.
- **`solves.duel_id` / `tournament_id` are plain nullable UUID columns, no ForeignKey** —
  the `duels`/`tournaments` tables don't exist yet; FK constraints come in stage 3.x/5.x.

## Stage 2.2 — authentication (backend)

- **fastapi-users 15** (`[sqlalchemy,oauth]`) drives register / login / verify / reset / OAuth.
- **Password hashing = argon2id via pwdlib** (`PasswordHelper(PasswordHash((Argon2Hasher(),)))`),
  not bcrypt. Hashes are stored as `$argon2id$...` in `user.hashed_password`.
- **JWT in an httpOnly cookie**, not a bearer body. `CookieTransport(httponly=True,
  secure=APP_ENV!=local, samesite="lax", max_age=JWT_LIFETIME_SECONDS)` +
  `JWTStrategy`. Access-only; no refresh/rotation this stage.
- **CSRF topology = same-origin proxy.** The frontend proxies `/api` to the backend, so the
  cookie is `SameSite=Lax` + `Secure` and no CSRF middleware is needed. Deploy (2.6) must
  proxy front→back under one origin (Vercel rewrites / reverse-proxy).
- **Secrets fail closed.** `SECRET` and `RESET_VERIFY_SECRET` are required (boot raises
  `ValidationError` if unset), `min_length>=32`, and outside `APP_ENV=local` any value
  containing a placeholder fragment (`change-me`, `example`, …) is rejected.
- **Split secrets:** reset/verify tokens are signed with `RESET_VERIFY_SECRET`, separate from
  the auth-JWT `SECRET` (blast-radius containment).
- **OAuth nickname is nullable + derived.** `oauth_callback` creates the user with only
  email/password/verified, so `user.nickname` is nullable and `UserManager.oauth_callback`
  derives one from the email local-part (UserCreate is bypassed by OAuth).
- **OAuth callback redirects.** The stock router returns 204; our custom callback sets the
  auth cookie then `RedirectResponse(FRONTEND_URL)`.
- **`email_verified` is checked, not trusted.** `associate_by_email` / `is_verified_by_default`
  are only honored when Google's `email_verified` claim (read from the OpenID userinfo
  endpoint, fail-closed) is true — prevents account takeover via unverified provider email.
- **Rate limiting is dependency-based (not the `@limiter.limit` decorator, which doesn't
  compose with fastapi-users routers).** A FastAPI dependency checks the async `limits`
  backend and raises `RateLimitExceeded` → 429. IP-based `AUTH_RATE_LIMIT` on auth routes,
  plus a tighter per-target-email `EMAIL_RATE_LIMIT` on register/forgot/request-verify.
  Client IP comes from `request.client.host` rewritten by uvicorn `ProxyHeadersMiddleware`
  from `X-Forwarded-For` for **trusted proxies only** — never raw XFF. In-memory store is
  per-worker (Redis multi-worker hardening deferred).
- **Verification does NOT gate login in 2.2** — unverified users can log in and solo-solve
  (less MVP friction); `is_verified` is carried for future duel/tournament gates.
- **Migration 0002 was hand-written** (Docker/Postgres unavailable to autogenerate against)
  to mirror `SQLAlchemyBaseOAuthAccountTableUUID` exactly + a `user_id` index; user->oauth FK
  is `ondelete=CASCADE`. Verify with a live `alembic upgrade head` against Postgres in deploy.
