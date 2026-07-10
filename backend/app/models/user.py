from datetime import datetime
from typing import TYPE_CHECKING

from fastapi_users_db_sqlalchemy import SQLAlchemyBaseUserTableUUID
from sqlalchemy import DateTime, Integer, String, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base

if TYPE_CHECKING:
    from app.models.oauth_account import OAuthAccount


class User(SQLAlchemyBaseUserTableUUID, Base):
    """User account.

    Inherits UUID PK, table name ``user``, and
    ``email`` / ``hashed_password`` / ``is_active`` / ``is_superuser`` /
    ``is_verified`` from the fastapi-users base (adopted now so the 2.2 auth
    stage does not have to rewrite the table). App-specific columns below.
    """

    # Nullable: OAuth sign-up (fastapi-users ``oauth_callback``) creates the row
    # with only email/hashed_password/is_verified — the UserManager then derives
    # a nickname. A NOT NULL nickname would make that INSERT fail.
    nickname: Mapped[str | None] = mapped_column(String(length=64), nullable=True)
    avatar_url: Mapped[str | None] = mapped_column(String(length=512), nullable=True)
    cups: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    best_single_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    best_ao5_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
    )

    oauth_accounts: Mapped[list["OAuthAccount"]] = relationship(
        "OAuthAccount",
        lazy="joined",
        cascade="all, delete-orphan",
    )
