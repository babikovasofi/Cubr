import uuid
from datetime import datetime

from fastapi_users_db_sqlalchemy.generics import GUID
from sqlalchemy import DateTime, ForeignKey, Integer, String, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base

# App-level status values (validated in the app layer, NOT a DB enum).
TOURNAMENT_ATTEMPT_STATUSES = ("started", "valid", "dnf")
# Mirrors the honesty axis from the frozen П5 solve-honesty design. This brick
# is plumbing only: every attempt is created "pending" and NOTHING here ever
# transitions it to "verified"/"rejected" — that lands in a future brick.
TOURNAMENT_ATTEMPT_HONESTY_STATES = ("pending", "verified", "rejected")


class Tournament(Base):
    """One row per ISO week: the single shared scramble every attempt uses.

    Created lazily by the first ``POST /tournament/current/attempt/start`` of
    the week (see ``app.services.tournament.get_or_create_current_tournament``).
    UNIQUE(iso_year, iso_week) is the idempotency guarantee under races.
    """

    __tablename__ = "tournaments"
    __table_args__ = (UniqueConstraint("iso_year", "iso_week", name="uq_tournaments_iso_week"),)

    # Portable GUID: native UUID on Postgres, CHAR(32) on sqlite (unit-testable).
    id: Mapped[uuid.UUID] = mapped_column(GUID, primary_key=True, default=uuid.uuid4)
    iso_year: Mapped[int] = mapped_column(Integer)
    iso_week: Mapped[int] = mapped_column(Integer)
    event: Mapped[str] = mapped_column(String(length=16), default="333", server_default="333")
    scramble: Mapped[str] = mapped_column(String(length=512))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
    )


class TournamentAttempt(Base):
    """One row per (user, tournament) — the caller's attempt at the weekly scramble.

    UNIQUE(user_id, tournament_id) is the idempotency guarantee: a second
    ``start`` by the same user in the same week reloads this row rather than
    creating a new one.
    """

    __tablename__ = "tournament_attempts"
    __table_args__ = (
        UniqueConstraint("user_id", "tournament_id", name="uq_tournament_attempts_user_tournament"),
    )

    id: Mapped[uuid.UUID] = mapped_column(GUID, primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        GUID,
        ForeignKey("user.id", ondelete="CASCADE"),
        index=True,
    )
    tournament_id: Mapped[uuid.UUID] = mapped_column(
        GUID,
        ForeignKey("tournaments.id", ondelete="CASCADE"),
        index=True,
    )
    status: Mapped[str] = mapped_column(
        String(length=16), default="started", server_default="started"
    )
    # Server-authoritative, never client-settable (TournamentAttemptSubmit has
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
