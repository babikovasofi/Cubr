import uuid
from datetime import datetime

import sqlalchemy as sa
from fastapi_users_db_sqlalchemy.generics import GUID
from sqlalchemy import Boolean, DateTime, ForeignKey, String, func
from sqlalchemy.dialects import postgresql
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class Cube(Base):
    __tablename__ = "cubes"

    # Portable GUID: native UUID on Postgres, CHAR(32) on sqlite (unit-testable).
    id: Mapped[uuid.UUID] = mapped_column(GUID, primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        GUID,
        ForeignKey("user.id", ondelete="CASCADE"),
        index=True,
    )
    name: Mapped[str] = mapped_column(String(length=64))
    note: Mapped[str | None] = mapped_column(String(length=255), nullable=True)
    is_primary: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    # color_profile: 6 positional-face (U/R/F/D/L/B) Lab reference triples.
    # Portable JSON: JSONB on Postgres, JSON (TEXT) on sqlite.
    color_profile: Mapped[dict[str, tuple[float, float, float]]] = mapped_column(
        sa.JSON().with_variant(postgresql.JSONB(), "postgresql"),
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
    )
    recalibrated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
    )
