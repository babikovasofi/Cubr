import uuid
from datetime import datetime

from fastapi_users_db_sqlalchemy.generics import GUID
from sqlalchemy import (
    Boolean,
    DateTime,
    ForeignKey,
    Integer,
    String,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base

# App-level status values (validated in the app layer, NOT a DB enum).
DUEL_ROOM_STATUSES = ("open", "full", "active", "finished", "abandoned")
DUEL_PLAYER_STATUSES = ("pending", "valid", "dnf")
# Mirrors the honesty axis from the frozen П5 solve-honesty design. This brick
# is plumbing only: every duel is created "pending" and NOTHING here ever
# transitions it to "verified"/"rejected" — and, unlike a future
# ranked/honesty-gated brick, `compute_winner` (app.services.duel) NEVER
# reads this column at all; the provisional `winner_id` is fully
# honesty-agnostic.
DUEL_HONESTY_STATES = ("pending", "verified", "rejected")


class DuelRoom(Base):
    """One row per link-invite duel room (Fast mode: exactly 1 solve/player).

    П11 ("one active duel per user") is enforced NOT here but by
    ``DuelParticipant``'s partial-UNIQUE(user_id) WHERE active — a two-column
    check on this table alone can't be raced safely with
    ``session.begin_nested()`` (see ``app.models.duel_participant``).

    `scramble` is plain text (no `scramble_token`/nonce for this brick — dead
    machinery here, see the plan) and is populated ONLY when the room
    transitions to `status == "active"` (`app.services.duel.persist_scramble`,
    called from the WS layer once both players are connected) — it is NEVER
    present in a REST response (`schemas.duel.DuelRoomRead` has no such
    field); it is only ever revealed over the WS `start` message.

    `a_honesty`/`b_honesty` default "pending" and are NEVER transitioned by
    this brick and NEVER read by `compute_winner` — `winner_id` is a
    provisional, honesty-agnostic result. `a_verify_frames_ok`/
    `b_verify_frames_ok` are the raw, unread signal from the same
    four-axis §П5 contract as `Solve.verify_frames_ok` — stored, never
    interpreted as a verdict.

    `parent_room_id` links a rematch child back to its parent, UNIQUE so
    `app.services.duel.rematch`'s get-or-create is race-safe under a double
    click by both players (see that function's docstring).

    `solves` is deliberately NOT written by this brick (§П5 PB-invariant
    frozen) — a full duel result lives entirely on this row.
    """

    __tablename__ = "duel_rooms"
    __table_args__ = (UniqueConstraint("parent_room_id", name="uq_duel_rooms_parent_room_id"),)

    # Portable GUID: native UUID on Postgres, CHAR(32) on sqlite (unit-testable).
    id: Mapped[uuid.UUID] = mapped_column(GUID, primary_key=True, default=uuid.uuid4)
    invite_token: Mapped[str] = mapped_column(String(length=64), unique=True, index=True)
    mode: Mapped[str] = mapped_column(String(length=16), default="fast", server_default="fast")
    event: Mapped[str] = mapped_column(String(length=16), default="333", server_default="333")
    status: Mapped[str] = mapped_column(
        String(length=16), default="open", server_default="open", index=True
    )

    # Plain text — see class docstring. Nullable until `status == "active"`.
    scramble: Mapped[str | None] = mapped_column(String(length=512), nullable=True)

    player_a_id: Mapped[uuid.UUID] = mapped_column(
        GUID, ForeignKey("user.id", ondelete="CASCADE"), index=True
    )
    player_b_id: Mapped[uuid.UUID | None] = mapped_column(
        GUID, ForeignKey("user.id", ondelete="CASCADE"), nullable=True, index=True
    )

    a_time_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    b_time_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    a_status: Mapped[str] = mapped_column(
        String(length=16), default="pending", server_default="pending"
    )
    b_status: Mapped[str] = mapped_column(
        String(length=16), default="pending", server_default="pending"
    )

    # Raw signal, never read as verdict — see class docstring.
    a_verify_frames_ok: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    b_verify_frames_ok: Mapped[bool | None] = mapped_column(Boolean, nullable=True)

    # Forward-compat plumbing only — never transitioned, never gates winner_id.
    a_honesty: Mapped[str] = mapped_column(
        String(length=16), default="pending", server_default="pending"
    )
    b_honesty: Mapped[str] = mapped_column(
        String(length=16), default="pending", server_default="pending"
    )

    a_finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    b_finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    # Provisional, honesty-agnostic winner — see class docstring.
    winner_id: Mapped[uuid.UUID | None] = mapped_column(GUID, nullable=True)

    parent_room_id: Mapped[uuid.UUID | None] = mapped_column(
        GUID, ForeignKey("duel_rooms.id", ondelete="SET NULL"), nullable=True, index=True
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
    )
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
