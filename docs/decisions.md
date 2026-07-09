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
