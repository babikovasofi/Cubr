from datetime import datetime
from typing import TYPE_CHECKING

from fastapi_users_db_sqlalchemy import SQLAlchemyBaseUserTableUUID
from sqlalchemy import DateTime, Index, Integer, String, Text, func
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

    ``uq_user_handle_lower``: a case-insensitive UNIQUE index on ``handle``
    so "add a friend by handle" (and every other by-name lookup — profile,
    tournament/daily boards) is unambiguous — without it two people could
    hold handles differing only in case and a lookup by handle would be
    unable to tell them apart. It is a PARTIAL index (``WHERE handle IS NOT
    NULL``) on purpose: plain SQL ``UNIQUE`` never treats two ``NULL``s as
    equal, but the partial predicate additionally guarantees that
    handle-less users (mid-OAuth sign-up, or a password account that has not
    chosen one yet) coexist with no conflict.
    """

    # Nullable: OAuth sign-up (fastapi-users `oauth_callback`) creates the row
    # with only email/hashed_password/is_verified — the UserManager then
    # derives a handle (a NOT NULL column would make that INSERT fail).
    # Password sign-up leaves it unset until the person picks one; unset
    # renders as "Аноним" on public boards (see
    # `app.services.tournament.display_name_for`), never derived from email.
    #
    # ONE field doing what used to be two (`nickname` + `public_handle`):
    # product decision 2026-08-24 — a private display name and a separate
    # public "friend handle" confused people, since it was never obvious
    # which one a screen meant. Now there is exactly one name, unique
    # case-insensitively, shown everywhere (own header, friends, tournament/
    # daily boards) with a leading "@" (a frontend rendering concern — the
    # stored value itself carries no "@"). See migration
    # `0013_single_user_handle` for how existing `nickname`/`public_handle`
    # data was merged.
    handle: Mapped[str | None] = mapped_column(String(length=64), nullable=True)
    avatar_url: Mapped[str | None] = mapped_column(Text(), nullable=True)
    # Витрина профиля (V3): чем человек собирает и с какого года. Видны только
    # владельцу — публичных профилей в Cubr нет, на бордах живёт лишь
    # `handle` (П10). Оба поля необязательные: пустая витрина — норма.
    method: Mapped[str | None] = mapped_column(String(length=16), nullable=True)
    cubing_since_year: Mapped[int | None] = mapped_column(Integer, nullable=True)
    cups: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    best_single_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    best_ao5_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # Когда человек прошёл (или пропустил) онбординг. NULL — ещё не проходил.
    #
    # Признак СЕРВЕРНЫЙ, и это не педантизм. Раньше он жил в localStorage
    # (`cubr_onboarded`), то есть отвечал на вопрос «показывали ли в ЭТОМ
    # браузере», а не «проходил ли ЭТОТ человек». Отсюда два живых симптома:
    # первый вход нового аккаунта в браузере, где онбординг уже проходили,
    # молча уезжал на главную (поймано 2026-08-20 на первом входе через
    # Google), а тот же человек со второго устройства получал онбординг заново.
    onboarded_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )
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
            "uq_user_handle_lower",
            func.lower(handle),
            unique=True,
            postgresql_where=handle.isnot(None),
            sqlite_where=handle.isnot(None),
        ),
    )
