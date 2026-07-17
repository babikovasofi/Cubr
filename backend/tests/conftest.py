import os

# Secrets MUST exist before importing the app (config fails closed on missing
# SECRET / RESET_VERIFY_SECRET). APP_ENV stays `local` so cookies are non-Secure
# and can be stored by the httpx test client over http://.
os.environ.setdefault("SECRET", "kQ7m2Zt9v-unit-jwt-signing-key-0123456789abcdef")
os.environ.setdefault("RESET_VERIFY_SECRET", "wX4n8Rb1cY-unit-reset-verify-key-fedcba9876543210")
os.environ.setdefault("SCRAMBLE_SIGN_SECRET", "p9Lm3Fq6Ts-unit-scramble-sign-key-abcdef0123456789")
os.environ.setdefault("APP_ENV", "local")
os.environ.setdefault("AUTH_RATE_LIMIT", "10/minute")
os.environ.setdefault("EMAIL_RATE_LIMIT", "3/hour")

from collections.abc import AsyncGenerator  # noqa: E402

import pytest  # noqa: E402
import pytest_asyncio  # noqa: E402
import sqlalchemy as sa  # noqa: E402
from httpx import ASGITransport, AsyncClient  # noqa: E402
from sqlalchemy.ext.asyncio import (  # noqa: E402
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.pool import StaticPool  # noqa: E402

from app.db import Base, get_session  # noqa: E402
from app.main import app  # noqa: E402
from app.models import (  # noqa: E402
    Cube,
    OAuthAccount,
    Scramble,
    Solve,
    Tournament,
    TournamentAttempt,
    User,
)
from app.services import ratelimit  # noqa: E402

TEST_DATABASE_URL = "sqlite+aiosqlite:///:memory:"


class EmailSpy:
    """Records (to, token) for every email that would have been sent."""

    def __init__(self) -> None:
        self.verifications: list[tuple[str, str]] = []
        self.resets: list[tuple[str, str]] = []

    async def send_verification_email(self, to: str, token: str) -> None:
        self.verifications.append((to, token))

    async def send_reset_email(self, to: str, token: str) -> None:
        self.resets.append((to, token))


@pytest.fixture
def email_spy(monkeypatch: pytest.MonkeyPatch) -> EmailSpy:
    spy = EmailSpy()
    # Patch on the email module — auth.py looks the names up on it at call time.
    monkeypatch.setattr("app.services.email.send_verification_email", spy.send_verification_email)
    monkeypatch.setattr("app.services.email.send_reset_email", spy.send_reset_email)
    return spy


@pytest_asyncio.fixture(autouse=True)
async def _reset_rate_limiter() -> AsyncGenerator[None, None]:
    await ratelimit.reset_limiter_state()
    yield
    await ratelimit.reset_limiter_state()


@pytest_asyncio.fixture
async def test_engine() -> AsyncGenerator[AsyncEngine, None]:
    # StaticPool: a single shared in-memory connection so tables created here are
    # visible to every request session AND to test-side inspection queries.
    engine = create_async_engine(
        TEST_DATABASE_URL,
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )

    # sqlite ignores FK actions unless PRAGMA foreign_keys is ON — enable it so
    # `solves.cube_id` ON DELETE SET NULL fires (matches Postgres behaviour).
    @sa.event.listens_for(engine.sync_engine, "connect")
    def _fk_pragma(dbapi_conn: object, _rec: object) -> None:
        cursor = dbapi_conn.cursor()  # type: ignore[attr-defined]
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()

    # `solves` now uses the portable GUID type, so it renders on sqlite too.
    async with engine.begin() as conn:
        await conn.run_sync(
            lambda c: Base.metadata.create_all(
                c,
                tables=[
                    User.__table__,
                    OAuthAccount.__table__,
                    Cube.__table__,
                    Scramble.__table__,
                    Solve.__table__,
                    Tournament.__table__,
                    TournamentAttempt.__table__,
                ],
            )
        )
    yield engine
    await engine.dispose()


@pytest_asyncio.fixture
async def session_maker(test_engine: AsyncEngine) -> async_sessionmaker[AsyncSession]:
    return async_sessionmaker(test_engine, expire_on_commit=False)


@pytest_asyncio.fixture
async def client(
    session_maker: async_sessionmaker[AsyncSession],
) -> AsyncGenerator[AsyncClient, None]:
    async def override_get_session() -> AsyncGenerator[AsyncSession, None]:
        async with session_maker() as session:
            yield session

    app.dependency_overrides[get_session] = override_get_session

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac

    app.dependency_overrides.clear()
