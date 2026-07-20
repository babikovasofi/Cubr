from datetime import date, datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

AttemptStatus = Literal["started", "valid", "dnf"]


class DailyAttemptSubmit(BaseModel):
    """Inbound payload for recording a daily-attempt result.

    ``status`` is a client-facing Literal that excludes ``"started"`` (the
    only pre-submit state) — a client can only ever submit a terminal result.
    ``honesty`` is deliberately absent: it is server-only and stays "pending"
    for every attempt created by this brick.
    """

    model_config = ConfigDict(extra="forbid")

    time_ms: int = Field(gt=0)
    status: Literal["valid", "dnf"] = "valid"


class DailyAttemptRead(BaseModel):
    """Public representation of an attempt, merged with its daily challenge's
    date/scramble fields. The scramble is populated ONLY on the authed
    start/submit responses this schema backs (П8 — never a public route).
    """

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    daily_id: UUID
    status: str
    honesty: str
    time_ms: int | None
    started_at: datetime
    submitted_at: datetime | None
    date: date
    day_label: str
    event: str
    scramble: str


class BoardEntry(BaseModel):
    """One row on the de-ranked participation board.

    Deliberately has NO rank/position field (true ranking waits for the
    honesty-verification brick) and NO email/nickname — ``display_name`` is
    always ``public_handle`` or the literal "Аноним"
    (``app.services.tournament.display_name_for``).
    """

    model_config = ConfigDict(from_attributes=True)

    display_name: str
    time_ms: int
    is_self: bool


class DailyBoardRead(BaseModel):
    """Current-UTC-day participation board: `status=="valid"` completers
    ordered by `submitted_at ASC, id ASC`. Read-only (creates nothing, no
    scramble). Absent/empty daily challenge -> empty entries + zero counts,
    not 404.
    """

    model_config = ConfigDict(from_attributes=True)

    date: date
    day_label: str
    event: str
    entries: list[BoardEntry]
    your_entry: BoardEntry | None
    valid_count: int
    dnf_count: int


class DailyCurrentRead(BaseModel):
    """Read-only state of the caller's current-day daily challenge,
    deliberately WITHOUT a ``scramble`` field — this schema backs the ``GET
    /daily/current`` endpoint, the one route that MUST NEVER reveal the daily
    scramble (П8). It never triggers a create: ``attempt_status`` and the
    attempt-derived fields are ``None`` when no challenge/attempt exists yet
    for this user today.
    """

    model_config = ConfigDict(from_attributes=True)

    date: date
    day_label: str
    event: str
    attempt_status: AttemptStatus | None
    time_ms: int | None
    started_at: datetime | None
    submitted_at: datetime | None
    deadline_at: datetime | None
