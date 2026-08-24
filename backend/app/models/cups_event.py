import uuid
from datetime import datetime

from fastapi_users_db_sqlalchemy.generics import GUID
from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class CupsEvent(Base):
    """One row per (duel room, player) cups adjustment — see `app.services.cups`.

    `UNIQUE(room_id, user_id)` is the idempotency guarantee behind
    `app.services.cups.award_for_finished_room`'s `begin_nested()` +
    `IntegrityError` pattern (mirrors `app.services.badges.grant` /
    `app.services.tournament`'s get-or-create shape): a duel room can be
    finalized at most twice-ever-attempted (retry, rematch race, a
    concurrently-firing timeout), and this constraint guarantees cups are
    ever applied ONCE per room per player no matter how many times
    finalization is (re)triggered.

    `opponent_id` is stored directly (not derived by joining back through
    `duel_rooms`) so the anti-farm rolling-24h "how many times have THESE
    TWO played each other" query (`app.services.cups._recent_matchup_count`)
    is a single indexed lookup, not a join.

    `delta` is the ACTUAL cups change applied (post rank-floor clamp), not
    the raw table value — so summing `delta` over a user's rows always
    equals their current `cups` exactly, which is what makes this table
    double as the source for a future "cups road" timeline on the frontend
    (`cups_before`/`cups_after` give each step of that road for free).

    Deliberately NEVER honesty-gated (mirrors `UserBadge`): no honesty
    column here, cups are awarded on the room's provisional
    honesty-agnostic `winner_id` — same as everything else in this duel
    brick (§П5 PB-invariant frozen, no link to `solves` either).
    """

    __tablename__ = "cups_events"
    __table_args__ = (UniqueConstraint("room_id", "user_id", name="uq_cups_events_room_user"),)

    id: Mapped[uuid.UUID] = mapped_column(GUID, primary_key=True, default=uuid.uuid4)
    room_id: Mapped[uuid.UUID] = mapped_column(
        GUID, ForeignKey("duel_rooms.id", ondelete="CASCADE"), index=True
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        GUID, ForeignKey("user.id", ondelete="CASCADE"), index=True
    )
    opponent_id: Mapped[uuid.UUID] = mapped_column(
        GUID, ForeignKey("user.id", ondelete="CASCADE"), index=True
    )
    delta: Mapped[int] = mapped_column(Integer)
    # Business meaning of the event — "win" | "loss" | "draw" | "walkover_win" |
    # "walkover_loss". A short string, not a DB enum (same choice as
    # `DuelRoom.status`/`DUEL_ROOM_STATUSES`: validated in the app layer).
    reason: Mapped[str] = mapped_column(String(length=32))
    # Whether the anti-farm rolling-window cap reduced this event's delta
    # (see `app.services.cups.FARM_FULL_ALLOWANCE`). Kept as its own column
    # (not folded into `reason`) so it stays a simple, queryable flag rather
    # than doubling the number of reason strings.
    farm_limited: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    cups_before: Mapped[int] = mapped_column(Integer)
    cups_after: Mapped[int] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
    )
