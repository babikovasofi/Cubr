"""Duel-invite-in-chat — friends-hub plan, Этап B.

`DuelInvite` is the **source of truth** for an invite's lifecycle state
(skeptic HIGH#2): `ChatMessage` has no state column of its own, and
`DuelRoom.status` can't stand in for it either — an old invite bubble in the
scrollback must render "expired"/"declined" correctly even though the ROOM
it eventually spawned (if any) has long since moved on to `active`/
`finished`. Every read of an invite's state (`app.services.chat_invite.
build_invite_read`, called on every `GET /chat/poll` and
`GET /chat/conversations/{id}/messages`) re-derives it from THIS row, fresh,
every time — never cached on the `ChatMessage` and never re-delivered by the
poll's own cursor (a state flip is not a new message).

`(id, message_id FK, inviter_id, invitee_id, state, room_id, created_at,
expires_at, resolved_at)` — exactly the shape the plan's skeptic-resolution
section specifies.

**No room at send time** (skeptic HIGH#1): `room_id` starts `NULL` and is
only ever set by `app.services.chat_invite.accept_invite`, in the SAME
transaction that calls `app.services.duel.create_room`/`join_room` — sending
an invite never touches `DuelParticipant`'s partial-UNIQUE(user_id) slot, so
N invites to N different friends cost 0 duel slots.

State machine (`state`, CHECK-enforced, mirrors `FRIENDSHIP_STATUSES`'/
`DUEL_ROOM_STATUSES`' "app-level enum, not a DB enum type" convention):

* `pending` -> `accepted` (invitee accepted, in time — `room_id` set)
* `pending` -> `declined` (invitee declined)
* `pending` -> `canceled` (inviter canceled)
* `pending` -> `expired` (nobody acted before `expires_at` — see
  `app.services.chat_invite.effective_state`: this is mostly a DISPLAY-time
  derivation, not a background sweep; the DB row often still physically
  reads `pending` until the next mutating attempt opportunistically
  persists `expired`, but every caller-visible read reports the derived
  value)
* `accepted` -> `declined`/`canceled` is possible ONLY as a narrow race
  courtesy: if a decline/cancel request loses a race to a concurrent accept,
  `app.services.chat_invite` still honors the decline/cancel's INTENT by
  abandoning the just-created room (`app.services.duel.abandon_room`) rather
  than surfacing a confusing "not pending" error over what the human
  experienced as one clean click.

`expires_at = created_at + settings.INVITE_TTL_SECONDS` (2-5 minute,
Discord/game-style window — deliberately NOT the 24h open-link TTL: a room
now only exists once accepted, so there is no slot sitting blocked while an
invite waits, and a stale button is a MUCH smaller cost than the old raw
link's 24h dangling-open-room problem).
"""

import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from fastapi_users_db_sqlalchemy.generics import GUID
from sqlalchemy import CheckConstraint, DateTime, ForeignKey, String, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base

if TYPE_CHECKING:
    from app.models.chat import ChatMessage

DUEL_INVITE_STATES = ("pending", "accepted", "declined", "canceled", "expired")


class DuelInvite(Base):
    """One row per duel-invite chat message. See module docstring."""

    __tablename__ = "duel_invites"
    __table_args__ = (
        CheckConstraint(
            "state IN ('pending','accepted','declined','canceled','expired')",
            name="ck_duel_invites_state",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(GUID, primary_key=True, default=uuid.uuid4)
    # UNIQUE — strictly one-to-one with its ChatMessage (see that model's
    # `invite` relationship).
    message_id: Mapped[uuid.UUID] = mapped_column(
        GUID, ForeignKey("chat_messages.id", ondelete="CASCADE"), unique=True
    )
    inviter_id: Mapped[uuid.UUID] = mapped_column(
        GUID, ForeignKey("user.id", ondelete="CASCADE"), index=True
    )
    invitee_id: Mapped[uuid.UUID] = mapped_column(
        GUID, ForeignKey("user.id", ondelete="CASCADE"), index=True
    )
    state: Mapped[str] = mapped_column(
        String(length=16), default="pending", server_default="pending"
    )
    # NULL until `accept_invite` mints it — see module docstring.
    room_id: Mapped[uuid.UUID | None] = mapped_column(
        GUID, ForeignKey("duel_rooms.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    message: Mapped["ChatMessage"] = relationship("ChatMessage", back_populates="invite")
