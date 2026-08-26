"""Random-opponent matchmaking queue — friends-hub plan, Этап C.

**In the DB, not in process memory** (skeptic HIGH#3) — unlike
`app.services.duel_manager`'s in-memory `RoomState` (which `main.py`'s
lifespan explicitly accepts losing on restart, deliberately, for the
in-flight realtime duel machinery), a QUEUED-BUT-NOT-YET-MATCHED wait must
survive a deploy: a process restart must not strand someone in "ищем
соперника…" forever. One row per waiting user (mirrors
`app.models.chat.UserPresence`'s "one row per user, PK is the user" shape —
the same table this plan's HIGH#3 finding cites as the precedent that
already survives a restart).

`room_id` starts `NULL` (still waiting) and is set exactly once, by
`app.services.matchmaking.enqueue`'s pairing transaction, in the SAME
SAVEPOINT that calls `app.services.duel.create_room`/`join_room` — a row
with `room_id` set is "matched, not yet consumed"; the matched user's own
`GET /matchmaking/poll` (or their own next `enqueue` call) picks it up,
mints their `session_token`, and the row is deleted.

`user_id` is the PRIMARY KEY (not a separate surrogate `id` + a UNIQUE
constraint) — this table is inherently "at most one open matchmaking
intent per user" and needs no other identity; enqueue is a plain
get-or-create keyed on it (mirrors `UserPresence` again).

Deliberately excludes the caller's OWN `chat_blocks` pairs and skips a
candidate already claimed by a concurrent pairing attempt — see
`app.services.matchmaking` for both. `app.services.duel.create_room`'s
partial-UNIQUE(user_id) WHERE active is the actual, DB-enforced defense
against pairing someone who already has another active duel (skeptic
HIGH#4): `enqueue` pre-checks it for a fast 409, but the REAL guarantee is
that same constraint doing what it always does.
"""

import uuid
from datetime import datetime

from fastapi_users_db_sqlalchemy.generics import GUID
from sqlalchemy import DateTime, ForeignKey, Index, func, text
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class MatchmakingQueue(Base):
    """One row per user currently queued (or just-matched-but-not-yet-
    consumed) for random-opponent matchmaking. See module docstring.
    """

    __tablename__ = "matchmaking_queue"
    __table_args__ = (
        # Backs the candidate lookup in `app.services.matchmaking.enqueue`
        # (`WHERE room_id IS NULL ORDER BY created_at`) — partial, so it
        # stays the size of the currently-waiting pool, not the whole
        # matched-and-about-to-be-deleted backlog (which is usually ~empty
        # anyway, but the same "partial index" reasoning as
        # `app.models.chat`'s `ix_chat_messages_notify` applies).
        Index(
            "ix_matchmaking_queue_waiting",
            "created_at",
            postgresql_where=text("room_id IS NULL"),
            sqlite_where=text("room_id IS NULL"),
        ),
    )

    user_id: Mapped[uuid.UUID] = mapped_column(
        GUID, ForeignKey("user.id", ondelete="CASCADE"), primary_key=True
    )
    room_id: Mapped[uuid.UUID | None] = mapped_column(
        GUID, ForeignKey("duel_rooms.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
