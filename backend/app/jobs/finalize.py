"""Weekly-tournament finalize job: sweep every expired ``started`` attempt to
``dnf``. The artifact an EXTERNAL scheduler (system cron / container CronJob /
platform scheduler) invokes — not an in-process APScheduler tied to a web
worker. See ``backend/README.md`` § Scheduled finalize for why, and
``swarm-report/finalize-cron-plan.md`` for the full design.

Idempotent: safe to run at any frequency, including overlapping runs from
multiple external triggers — ``sweep_expired_attempts`` re-guards
``status == "started"`` in its UPDATE, so a row already finalized by a prior
or concurrent run simply matches 0 rows.

Run directly:

    cd backend && uv run python -m app.jobs.finalize
"""

import asyncio
import logging

from app.config import get_settings
from app.services.tournament import now_utc, sweep_expired_attempts

logger = logging.getLogger("cubr.jobs.finalize")


async def run() -> int:
    """Open a session, sweep expired attempts, commit, log + return the count."""
    # Imported here (like app.seed.main) so this module is importable without
    # a real engine/DB connection unless actually run.
    from app.db import async_session_maker

    settings = get_settings()
    async with async_session_maker() as session:
        swept = await sweep_expired_attempts(
            session, now_utc(), settings.TOURNAMENT_ATTEMPT_WINDOW_SECONDS
        )
        await session.commit()

    logger.info(f"finalize: swept {swept} expired attempts")
    return swept


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    asyncio.run(run())
