"""`alembic upgrade head` / `downgrade -1` / `upgrade head` against a REAL
Postgres — sqlite can't run this project's migration chain at all (it has
diverged from `Base.metadata` since 0007_duel_rooms; the test suite's sqlite
schema is built straight from the models via `Base.metadata.create_all` in
`tests/conftest.py`, never through Alembic).

Opt-in via `MIGRATION_TEST_DATABASE_URL` (a Postgres URL, `postgresql+
asyncpg://...`) — unset in CI/local `pytest` runs by default, so this test
is a `pytest.mark.skip`, not a `pytest.mark.xfail`: absence of the env var
means "not verified this run", not "known broken".
"""

import os
import subprocess
import sys
from pathlib import Path

import pytest

BACKEND_DIR = Path(__file__).resolve().parent.parent
MIGRATION_TEST_DATABASE_URL = os.environ.get("MIGRATION_TEST_DATABASE_URL")


def _run_alembic(*args: str, database_url: str) -> subprocess.CompletedProcess[str]:
    env = dict(os.environ)
    env["DATABASE_URL"] = database_url
    return subprocess.run(
        [sys.executable, "-m", "alembic", *args],
        cwd=BACKEND_DIR,
        env=env,
        capture_output=True,
        text=True,
        timeout=120,
    )


@pytest.mark.skipif(
    not MIGRATION_TEST_DATABASE_URL,
    reason=(
        "MIGRATION_TEST_DATABASE_URL not set — this project's migration chain "
        "already can't run on sqlite (diverged from Base.metadata since "
        "0007_duel_rooms), so this test needs a real Postgres to opt into."
    ),
)
def test_upgrade_downgrade_upgrade() -> None:
    assert MIGRATION_TEST_DATABASE_URL is not None  # narrows for mypy under skipif
    up1 = _run_alembic("upgrade", "head", database_url=MIGRATION_TEST_DATABASE_URL)
    assert up1.returncode == 0, up1.stdout + up1.stderr

    down = _run_alembic("downgrade", "-1", database_url=MIGRATION_TEST_DATABASE_URL)
    assert down.returncode == 0, down.stdout + down.stderr

    up2 = _run_alembic("upgrade", "head", database_url=MIGRATION_TEST_DATABASE_URL)
    assert up2.returncode == 0, up2.stdout + up2.stderr
