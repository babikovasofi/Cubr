import uuid
from datetime import date, datetime

from fastapi_users_db_sqlalchemy.generics import GUID
from sqlalchemy import Date, DateTime, ForeignKey, Integer, String, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base

# App-level status values (validated in the app layer, NOT a DB enum).
DAILY_ATTEMPT_STATUSES = ("started", "valid", "dnf")
# Mirrors the honesty axis from the frozen П5 solve-honesty design. This brick
# is plumbing only: every attempt is created "pending" and NOTHING here ever
# transitions it to "verified"/"rejected" — that lands in a future brick.
DAILY_ATTEMPT_HONESTY_STATES = ("pending", "verified", "rejected")


class DailyChallenge(Base):
    """One row per UTC calendar date: the single shared scramble every attempt uses.

    Created lazily by the first ``POST /daily/current/attempt/start`` of the
    day (see ``app.services.daily.get_or_create_current_daily``). UNIQUE(date)
    is the idempotency guarantee under races.
    """

    __tablename__ = "daily_challenges"
    __table_args__ = (UniqueConstraint("date", name="uq_daily_challenges_date"),)

    # Portable GUID: native UUID on Postgres, CHAR(32) on sqlite (unit-testable).
    id: Mapped[uuid.UUID] = mapped_column(GUID, primary_key=True, default=uuid.uuid4)
    date: Mapped[date] = mapped_column(Date)
    event: Mapped[str] = mapped_column(String(length=16), default="333", server_default="333")
    scramble: Mapped[str] = mapped_column(String(length=512))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
    )


class DailyAttempt(Base):
    """One row per (user, daily) — the caller's attempt at the daily scramble.

    UNIQUE(user_id, daily_id) is the idempotency guarantee: a second ``start``
    by the same user on the same UTC day reloads this row rather than
    creating a new one.
    """

    __tablename__ = "daily_attempts"
    __table_args__ = (UniqueConstraint("user_id", "daily_id", name="uq_daily_attempts_user_daily"),)

    id: Mapped[uuid.UUID] = mapped_column(GUID, primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        GUID,
        ForeignKey("user.id", ondelete="CASCADE"),
        index=True,
    )
    daily_id: Mapped[uuid.UUID] = mapped_column(
        GUID,
        ForeignKey("daily_challenges.id", ondelete="CASCADE"),
        index=True,
    )
    status: Mapped[str] = mapped_column(
        String(length=16), default="started", server_default="started"
    )
    # Server-authoritative, never client-settable (DailyAttemptSubmit has
    # extra="forbid" and no honesty field). This brick never writes anything
    # other than the default "pending" here.
    honesty: Mapped[str] = mapped_column(
        String(length=16), default="pending", server_default="pending"
    )
    time_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    started_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
    )
    submitted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
