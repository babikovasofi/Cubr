import uuid
from datetime import datetime

from fastapi_users_db_sqlalchemy.generics import GUID
from sqlalchemy import Boolean, DateTime, ForeignKey, Index, func, text
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class DuelParticipant(Base):
    """One row per (user, room) a user has ever joined — the physical
    enforcement of П11 ("one active duel per user").

    Skeptic-hardened design (HIGH#1 fix): a two-column check on `DuelRoom`
    alone (e.g. "is this user player_a/player_b of any non-terminal room")
    can't be raced safely with `session.begin_nested()` — a SAVEPOINT only
    rolls back on an actual constraint violation, and there is no single
    UNIQUE constraint you can put on `DuelRoom` that catches "this user is
    already in some OTHER room". A normalized participant row + a **partial
    UNIQUE index on `user_id` WHERE `active`** gives exactly that constraint:
    at most one `active=true` row per `user_id`, DB-enforced, so
    `app.services.duel.create_room`/`join_room`/`rematch` can insert inside a
    nested transaction and rely on `IntegrityError` to detect the race (same
    pattern as `app.services.tournament`'s UNIQUE(iso_year, iso_week) /
    UNIQUE(user_id, tournament_id) get-or-create, but here the row it
    protects — `DuelRoom` — isn't itself keyed the same way on both sides).

    A participant's `active` flips to `false` when its room finalizes
    (`app.services.duel.finalize_room`) or is abandoned (`abandon_room`) —
    never deleted, so a user's duel history is preserved.

    The partial index is declared as both `postgresql_where` (real deploy)
    and `sqlite_where` (unit tests create tables via
    `Base.metadata.create_all`, not via Alembic — see `tests/conftest.py`) so
    the race is actually testable on sqlite too.
    """

    __tablename__ = "duel_participants"
    __table_args__ = (
        Index(
            "uq_duel_participants_user_active",
            "user_id",
            unique=True,
            postgresql_where=text("active"),
            sqlite_where=text("active"),
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(GUID, primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        GUID, ForeignKey("user.id", ondelete="CASCADE"), index=True
    )
    room_id: Mapped[uuid.UUID] = mapped_column(
        GUID, ForeignKey("duel_rooms.id", ondelete="CASCADE"), index=True
    )
    active: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
    )
