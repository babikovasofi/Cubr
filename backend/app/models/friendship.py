import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from fastapi_users_db_sqlalchemy.generics import GUID
from sqlalchemy import CheckConstraint, DateTime, ForeignKey, String, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base

if TYPE_CHECKING:
    from app.models.user import User

# App-level status values (validated in the app layer AND by the DB CHECK
# below, NOT a DB enum type — mirrors app.models.duel's DUEL_ROOM_STATUSES).
FRIENDSHIP_STATUSES = ("pending", "accepted")


class Friendship(Base):
    """One row per unordered pair of users — a pending friend request or an
    accepted friendship. Never two rows for the same pair: (A, B) and (B, A)
    are the same relationship, and a user can never be friends with (or
    request) themself.

    Pair ordering (`user_low_id < user_high_id`, physically enforced by
    `ck_friendships_ordered_pair` below) is computed in Python by
    `app.services.friends.pair_key` = `tuple(sorted((a, b)))` on
    `uuid.UUID` values. Python compares `UUID`s by their `.int` — which
    agrees with Postgres's native `uuid` column ordering (byte-wise, same
    128-bit value) AND with sqlite's `GUID` column here (a 32-char hex
    string with no dashes: comparing equal-length hex strings
    lexicographically compares the same 128-bit integers digit-by-digit,
    most-significant first, since hex digits map 1:1 onto 4-bit groups of
    that integer). If `user.id`'s column type ever changes, this invariant
    must be re-verified against the new type's own comparison order — it is
    not automatic.

    `UniqueConstraint(user_low_id, user_high_id)` + `CheckConstraint
    (user_low_id < user_high_id)` together make BOTH a mirrored duplicate
    insert (B,A when (A,B) already exists) AND a self-friendship
    (`user_low_id == user_high_id`) physically impossible at the DB layer —
    an `IntegrityError`, not merely a service-layer check. See
    `app.services.friends.send_request`'s `session.begin_nested()` pattern,
    which mirrors `app.services.duel.create_room`'s
    get-or-create-under-a-race shape: attempt the insert inside a nested
    transaction, and on `IntegrityError` re-SELECT the row that won the
    race instead of raising raw.

    `requested_by_id` records who sent the still-open request (or who sent
    the ORIGINAL request that was later accepted) — `ck_friendships_
    requested_by_in_pair` keeps it inside the pair it names.
    """

    __tablename__ = "friendships"
    __table_args__ = (
        UniqueConstraint("user_low_id", "user_high_id", name="uq_friendships_pair"),
        CheckConstraint("user_low_id < user_high_id", name="ck_friendships_ordered_pair"),
        CheckConstraint(
            "requested_by_id = user_low_id OR requested_by_id = user_high_id",
            name="ck_friendships_requested_by_in_pair",
        ),
        CheckConstraint("status IN ('pending','accepted')", name="ck_friendships_status"),
    )

    id: Mapped[uuid.UUID] = mapped_column(GUID, primary_key=True, default=uuid.uuid4)
    user_low_id: Mapped[uuid.UUID] = mapped_column(
        GUID, ForeignKey("user.id", ondelete="CASCADE"), index=True
    )
    user_high_id: Mapped[uuid.UUID] = mapped_column(
        GUID, ForeignKey("user.id", ondelete="CASCADE"), index=True
    )
    requested_by_id: Mapped[uuid.UUID] = mapped_column(
        GUID, ForeignKey("user.id", ondelete="CASCADE")
    )
    status: Mapped[str] = mapped_column(
        String(length=16), default="pending", server_default="pending"
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
    )
    responded_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    # Eager-loaded explicitly by every service query that needs the "other
    # side"'s `handle` (async SQLAlchemy forbids lazy loading) —
    # see app.services.friends.list_friends/list_incoming/list_outgoing.
    user_low: Mapped["User"] = relationship("User", foreign_keys=[user_low_id])
    user_high: Mapped["User"] = relationship("User", foreign_keys=[user_high_id])
