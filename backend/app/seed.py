"""Dev seed: ready-made test accounts so you don't register by hand each time.

Professional practice, not a backdoor:
* **Local only.** Refuses to run unless ``APP_ENV=local`` — production never gets
  seeded test users, and there is NO auth bypass anywhere in the app.
* **Idempotent.** Re-running skips users that already exist (match by email).
* Users are created **already verified** with an argon2 hash (same helper as the
  real sign-up path), so you can log in immediately without the email step.

Run it (with the DB up and migrated):

    cd backend && docker-compose up -d && uv run alembic upgrade head
    uv run python -m app.seed

Then log in at the app with any address below and the shared password.
"""

import asyncio
import logging
from typing import TypedDict

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.config import get_settings
from app.models import Solve, User
from app.services.auth import password_helper

logger = logging.getLogger("cubr.seed")


class SeedSolve(TypedDict):
    scramble: str
    time_ms: int
    status: str


# Shared password for every seed account (local only — safe to hardcode here).
SEED_PASSWORD = "cubr-test-pw-123"

# NB: use a normal domain, not a reserved TLD like `.local` — email-validator
# (EmailStr on UserRead) rejects special-use names, which would 500 /users/me.
SEED_USERS: list[dict[str, str]] = [
    {"email": "test@example.com", "nickname": "tester"},
    {"email": "alice@example.com", "nickname": "alice"},
]

# A little solve history for the first account so /profile isn't empty.
SEED_SOLVES: list[SeedSolve] = [
    {"scramble": "R U R' U' F2 D L' B", "time_ms": 15230, "status": "valid"},
    {"scramble": "B2 L' B' L' D' B2 L' U2 R2 F2", "time_ms": 12980, "status": "valid"},
    {"scramble": "F R U' R' U' R U R' F'", "time_ms": 0, "status": "dnf"},
]


async def _seed_user(session: AsyncSession, data: dict[str, str]) -> bool:
    """Create one verified user if absent. Returns True if created."""
    existing = await session.scalar(select(User).filter_by(email=data["email"]))
    if existing is not None:
        return False
    user = User(
        email=data["email"],
        hashed_password=password_helper.hash(SEED_PASSWORD),
        is_active=True,
        is_superuser=False,
        is_verified=True,
        nickname=data["nickname"],
    )
    session.add(user)
    await session.flush()  # assign user.id

    # Give the first account some history + a best-single.
    if data["email"] == SEED_USERS[0]["email"]:
        best: int | None = None
        for s in SEED_SOLVES:
            session.add(
                Solve(
                    user_id=user.id,
                    scramble=s["scramble"],
                    time_ms=s["time_ms"] or 1,  # DB requires >0; DNF stored as 1ms
                    status=s["status"],
                    verify_frames_ok=(s["status"] == "valid"),
                )
            )
            if s["status"] == "valid" and (best is None or s["time_ms"] < best):
                best = s["time_ms"]
        user.best_single_ms = best
    return True


async def seed(session_maker: async_sessionmaker[AsyncSession]) -> list[str]:
    """Seed accounts. Returns the list of emails that were newly created."""
    if not get_settings().is_local:
        raise SystemExit("seed refuses to run outside APP_ENV=local")

    created: list[str] = []
    async with session_maker() as session:
        for data in SEED_USERS:
            if await _seed_user(session, data):
                created.append(data["email"])
        await session.commit()
    return created


async def main() -> None:
    logging.basicConfig(level=logging.INFO)
    # Import here so the module is importable in tests without a real engine.
    from app.db import async_session_maker

    created = await seed(async_session_maker)
    if created:
        logger.info("Created %d seed account(s): %s", len(created), ", ".join(created))
    else:
        logger.info("Seed accounts already present — nothing to do.")
    logger.info("Log in with any of %s using password %r", [u["email"] for u in SEED_USERS], SEED_PASSWORD)


if __name__ == "__main__":
    asyncio.run(main())
