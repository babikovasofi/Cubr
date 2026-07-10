import uuid
from datetime import datetime

from fastapi_users_db_sqlalchemy.generics import GUID
from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base

# App-level status values (validated in the app layer, NOT a DB enum).
SOLVE_STATUSES = ("valid", "dnf", "rejected")


class Solve(Base):
    __tablename__ = "solves"

    # Portable GUID: renders native UUID on Postgres (0001 migration schema
    # unchanged) and CHAR(32) on sqlite so the table is unit-testable.
    id: Mapped[uuid.UUID] = mapped_column(GUID, primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        GUID,
        ForeignKey("user.id", ondelete="CASCADE"),
        index=True,
    )
    # Plain nullable UUID columns — no ForeignKey: the `duels` / `tournaments`
    # tables do not exist yet (FKs come in stage 3.x/5.x).
    duel_id: Mapped[uuid.UUID | None] = mapped_column(GUID, nullable=True)
    tournament_id: Mapped[uuid.UUID | None] = mapped_column(GUID, nullable=True)

    scramble: Mapped[str] = mapped_column(String(length=512))
    time_ms: Mapped[int] = mapped_column(Integer)
    status: Mapped[str] = mapped_column(String(length=16), default="valid", server_default="valid")
    verify_frames_ok: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
    )
