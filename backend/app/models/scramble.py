import uuid
from datetime import datetime

from fastapi_users_db_sqlalchemy.generics import GUID
from sqlalchemy import DateTime, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class Scramble(Base):
    """A server-issued scramble, persisted lazily.

    ``GET /scramble`` never writes — it only signs a token (see
    ``app.services.scramble_token``). This row is created by ``POST /solves``
    alone, the moment a real solve consumes a valid, not-yet-used token.
    Anonymous issuance: no ``user_id`` column.
    """

    __tablename__ = "scrambles"

    # Portable GUID: native UUID on Postgres, CHAR(32) on sqlite (unit-testable).
    id: Mapped[uuid.UUID] = mapped_column(GUID, primary_key=True, default=uuid.uuid4)
    event: Mapped[str] = mapped_column(String(length=16), default="333", server_default="333")
    scramble: Mapped[str] = mapped_column(String(length=512))
    # The signed token's nonce. UNIQUE enforces one-time-use at the DB layer,
    # even under a concurrent double-submit of the same token.
    nonce: Mapped[str] = mapped_column(String(length=64), unique=True, index=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
    )
