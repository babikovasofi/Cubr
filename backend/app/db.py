import uuid
from collections.abc import AsyncGenerator
from typing import TYPE_CHECKING

from fastapi import Depends
from fastapi_users_db_sqlalchemy import SQLAlchemyUserDatabase
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.orm import DeclarativeBase

from app.config import get_settings

if TYPE_CHECKING:
    from app.models import User


class Base(DeclarativeBase):
    """Declarative base shared by all ORM models."""


engine: AsyncEngine = create_async_engine(
    get_settings().DATABASE_URL,
    pool_pre_ping=True,
)

async_session_maker = async_sessionmaker(
    engine,
    expire_on_commit=False,
    class_=AsyncSession,
)


async def get_session() -> AsyncGenerator[AsyncSession, None]:
    """Yield one `AsyncSession` per request (FastAPI dependency)."""
    async with async_session_maker() as session:
        yield session


async def get_user_db(
    session: AsyncSession = Depends(get_session),
) -> AsyncGenerator["SQLAlchemyUserDatabase[User, uuid.UUID]", None]:
    """fastapi-users DB adapter, bound to the request session.

    Imports the models locally to avoid a circular import at module load
    (models import ``Base`` from here).
    """
    from app.models import OAuthAccount, User

    yield SQLAlchemyUserDatabase(session, User, OAuthAccount)
