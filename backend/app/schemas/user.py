from datetime import datetime, timezone
from typing import Literal
from uuid import UUID

from fastapi_users import schemas
from pydantic import Field, field_validator


# Витрина профиля (V3). Список закрытый: свободный текст тут ничего не добавляет,
# а сортировать/подсказывать по нему нельзя. "other" — честный выход для всех
# остальных методов, чтобы не изображать полноту.
SolvingMethod = Literal["cfop", "roux", "zz", "petrus", "beginner", "other"]

# Спидкубинг как явление начался с изобретения кубика (1974); всё раньше —
# опечатка, а не биография. Верхняя граница — текущий год, будущее не считаем.
MIN_CUBING_YEAR = 1974


def _validate_year(value: int | None) -> int | None:
    if value is None:
        return None
    current_year = datetime.now(timezone.utc).year
    if value < MIN_CUBING_YEAR or value > current_year:
        raise ValueError(f"Год должен быть между {MIN_CUBING_YEAR} и {current_year}.")
    return value


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
    # Витрина: видна только владельцу (публичных профилей нет).
    method: SolvingMethod | None = None
    cubing_since_year: int | None = None
    # Прошёл ли человек онбординг. `null` — ещё нет, и фронт ведёт его по шагам.
    # Отдаётся только владельцу (`/users/me`), как и остальные поля выше.
    onboarded_at: datetime | None = None


class UserCreate(schemas.BaseUserCreate):
    """Registration payload (email + password auth)."""

    nickname: str | None = Field(default=None, max_length=64)


class UserUpdate(schemas.BaseUserUpdate):
    """Self-service user update payload."""

    nickname: str | None = Field(default=None, max_length=64)
    avatar_url: str | None = Field(default=None, max_length=512)
    public_handle: str | None = Field(default=None, max_length=64)
    method: SolvingMethod | None = None
    cubing_since_year: int | None = None

    @field_validator("cubing_since_year")
    @classmethod
    def _check_year(cls, value: int | None) -> int | None:
        return _validate_year(value)

    @field_validator("public_handle", mode="before")
    @classmethod
    def _clean_public_handle(cls, value: str | None) -> str | None:
        return _normalize_public_handle(value)
