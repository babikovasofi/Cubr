from datetime import datetime
from typing import TYPE_CHECKING

from fastapi_users_db_sqlalchemy import SQLAlchemyBaseUserTableUUID
from sqlalchemy import DateTime, Index, Integer, String, func
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

    ``uq_user_public_handle_lower`` (friends feature, see ``app.models.
    friendship``): a case-insensitive UNIQUE index on ``public_handle`` so
    "add by handle" is unambiguous — without it two people could hold
    handles differing only in case and a lookup by handle would be unable
    to tell them apart. It is a PARTIAL index (``WHERE public_handle IS NOT
    NULL``) on purpose: plain SQL ``UNIQUE`` never treats two ``NULL``s as
    equal, but the partial predicate additionally guarantees that unset
    handles are never even considered by the index, so any number of users
    without a handle coexist with no conflict. This does NOT make profiles
    public — ``public_handle`` stays opt-in/empty by default; the index only
    makes an already-public field (Т10, shown on tournament/daily boards)
    unambiguous to look up.
    """

    # Nullable: OAuth sign-up (fastapi-users ``oauth_callback``) creates the row
    # with only email/hashed_password/is_verified — the UserManager then derives
    # a nickname. A NOT NULL nickname would make that INSERT fail.
    nickname: Mapped[str | None] = mapped_column(String(length=64), nullable=True)
    avatar_url: Mapped[str | None] = mapped_column(String(length=512), nullable=True)
    # Deliberately-set, opt-in display name for public surfaces (e.g. the
    # weekly tournament standings board). Never derived from email/nickname —
    # unset renders as "Аноним" (see app.services.tournament.display_name_for).
    public_handle: Mapped[str | None] = mapped_column(String(length=64), nullable=True)
    # Витрина профиля (V3): чем человек собирает и с какого года. Видны только
    # владельцу — публичных профилей в Cubr нет, на бордах живёт лишь
    # `public_handle` (П10). Оба поля необязательные: пустая витрина — норма.
    method: Mapped[str | None] = mapped_column(String(length=16), nullable=True)
    cubing_since_year: Mapped[int | None] = mapped_column(Integer, nullable=True)
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

    __table_args__ = (
        Index(
            "uq_user_public_handle_lower",
            func.lower(public_handle),
            unique=True,
            postgresql_where=public_handle.isnot(None),
            sqlite_where=public_handle.isnot(None),
        ),
    )
