from uuid import UUID

from fastapi_users import schemas
from pydantic import Field


class UserRead(schemas.BaseUser[UUID]):
    """Public user representation returned by the API."""

    nickname: str | None = None
    avatar_url: str | None = None
    cups: int = 0
    best_single_ms: int | None = None
    best_ao5_ms: int | None = None


class UserCreate(schemas.BaseUserCreate):
    """Registration payload (email + password auth)."""

    nickname: str | None = Field(default=None, max_length=64)


class UserUpdate(schemas.BaseUserUpdate):
    """Self-service user update payload."""

    nickname: str | None = Field(default=None, max_length=64)
    avatar_url: str | None = Field(default=None, max_length=512)
