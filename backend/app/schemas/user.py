from uuid import UUID

from fastapi_users import schemas
from pydantic import Field, field_validator


def _normalize_public_handle(value: str | None) -> str | None:
    """Trim; empty string -> None. Length is enforced by the field's max_length."""
    if value is None:
        return None
    trimmed = value.strip()
    return trimmed or None


class UserRead(schemas.BaseUser[UUID]):
    """Public user representation returned by the API."""

    nickname: str | None = None
    avatar_url: str | None = None
    cups: int = 0
    best_single_ms: int | None = None
    best_ao5_ms: int | None = None
    # Deliberately-set, opt-in display name for public surfaces (e.g. the
    # weekly tournament standings board). NEVER email/nickname.
    public_handle: str | None = None


class UserCreate(schemas.BaseUserCreate):
    """Registration payload (email + password auth)."""

    nickname: str | None = Field(default=None, max_length=64)


class UserUpdate(schemas.BaseUserUpdate):
    """Self-service user update payload."""

    nickname: str | None = Field(default=None, max_length=64)
    avatar_url: str | None = Field(default=None, max_length=512)
    public_handle: str | None = Field(default=None, max_length=64)

    @field_validator("public_handle", mode="before")
    @classmethod
    def _clean_public_handle(cls, value: str | None) -> str | None:
        return _normalize_public_handle(value)
