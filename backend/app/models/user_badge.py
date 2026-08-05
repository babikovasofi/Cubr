import uuid
from datetime import datetime

from fastapi_users_db_sqlalchemy.generics import GUID
from sqlalchemy import DateTime, ForeignKey, String, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class UserBadge(Base):
    """One row per (user, badge code) ever granted — see `app.services.badges`.

    `code` is a key into `BADGE_REGISTRY` (metadata lives in code, not the
    DB — only grants persist here). `UNIQUE(user_id, code)` is the
    idempotency guarantee behind `app.services.badges.grant`'s
    `begin_nested()` + `IntegrityError` pattern (mirrors
    `app.services.tournament`'s get-or-create shape).

    Deliberately NEVER honesty-gated: no honesty column here, and nothing in
    `app.services.badges` reads any honesty field on `Solve`/`TournamentAttempt`/
    `DuelRoom` — badges are participation/self-reported achievements (see the
    plan's "Honesty decision"). Also deliberately NOT linked to `solves`
    (§П5 PB-invariant frozen) — a badge grant never writes/reads that table.
    """

    __tablename__ = "user_badges"
    __table_args__ = (UniqueConstraint("user_id", "code", name="uq_user_badges_user_code"),)

    id: Mapped[uuid.UUID] = mapped_column(GUID, primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        GUID, ForeignKey("user.id", ondelete="CASCADE"), index=True
    )
    code: Mapped[str] = mapped_column(String(length=64))
    earned_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
    )
