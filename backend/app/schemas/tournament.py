from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

AttemptStatus = Literal["started", "valid", "dnf"]


class TournamentAttemptSubmit(BaseModel):
    """Inbound payload for recording a tournament-attempt result.

    ``status`` is a client-facing Literal that excludes ``"started"`` (the
    only pre-submit state) — a client can only ever submit a terminal result.
    ``honesty`` is deliberately absent: it is server-only and stays "pending"
    for every attempt created by this brick.
    """

    model_config = ConfigDict(extra="forbid")

    time_ms: int = Field(gt=0)
    status: Literal["valid", "dnf"] = "valid"


class TournamentAttemptRead(BaseModel):
    """Public representation of an attempt, merged with its tournament's
    week/scramble fields. The scramble is populated ONLY on the authed
    start/submit responses this schema backs (П8 — never a public route).
    """

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    tournament_id: UUID
    status: str
    honesty: str
    time_ms: int | None
    started_at: datetime
    submitted_at: datetime | None
    iso_year: int
    iso_week: int
    week_label: str
    event: str
    scramble: str


class TournamentCurrentRead(BaseModel):
    """Read-only state of the caller's current-week tournament, deliberately
    WITHOUT a ``scramble`` field — this schema backs the ``GET
    /tournament/current`` endpoint, the one route that MUST NEVER reveal the
    weekly scramble (П8). It never triggers a create: ``attempt_status`` and
    the attempt-derived fields are ``None`` when no tournament/attempt exists
    yet for this user this week.
    """

    model_config = ConfigDict(from_attributes=True)

    iso_year: int
    iso_week: int
    week_label: str
    event: str
    attempt_status: AttemptStatus | None
    time_ms: int | None
    started_at: datetime | None
    submitted_at: datetime | None
    deadline_at: datetime | None
