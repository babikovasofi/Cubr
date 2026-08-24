from datetime import datetime, timezone
from typing import Literal
from uuid import UUID

from fastapi_users import schemas
from pydantic import Field, computed_field, field_validator

from app.services.cups import tier_bounds


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


def _normalize_handle(value: str | None) -> str | None:
    """Trim; empty string -> None. Length is enforced by the field's max_length."""
    if value is None:
        return None
    trimmed = value.strip()
    return trimmed or None


class UserRead(schemas.BaseUser[UUID]):
    """Public user representation returned by the API."""

    avatar_url: str | None = None
    cups: int = 0

    # Границы текущей ступени, ОДНИМ местом рассчитанные из `cups` через
    # `app.services.cups.tier_bounds` (та же таблица порогов, что и у
    # начисления) — фронт получает готовые пол/остаток и никогда не
    # дублирует у себя таблицу ступеней, которая иначе неизбежно разъедется
    # с бэкендом. `computed_field`, а не колонка на `User`: производное
    # значение от `cups`, никогда не хранится отдельно.
    @computed_field  # type: ignore[prop-decorator]
    @property
    def cups_rank(self) -> str:
        rank, _floor, _to_next = tier_bounds(self.cups)
        return rank

    @computed_field  # type: ignore[prop-decorator]
    @property
    def cups_floor(self) -> int:
        _rank, floor, _to_next = tier_bounds(self.cups)
        return floor

    @computed_field  # type: ignore[prop-decorator]
    @property
    def cups_to_next(self) -> int | None:
        """Cups still needed to reach the next rank's floor. `None` at the
        top (red) rank — open-ended, nothing to count down to."""
        _rank, _floor, to_next = tier_bounds(self.cups)
        return to_next

    best_single_ms: int | None = None
    best_ao5_ms: int | None = None
    # The ONE display name (own header, friends, tournament/daily boards).
    # Deliberately-set, opt-in — NEVER derived from email. Shown with a
    # leading "@" on the frontend; the stored value itself carries no "@".
    handle: str | None = None
    # Витрина: видна только владельцу (публичных профилей нет).
    method: SolvingMethod | None = None
    cubing_since_year: int | None = None
    # Прошёл ли человек онбординг. `null` — ещё нет, и фронт ведёт его по шагам.
    # Отдаётся только владельцу (`/users/me`), как и остальные поля выше.
    onboarded_at: datetime | None = None
    # Когда аккаунт заведён. Нужно фронту, чтобы отличить «человек существовал до
    # появления серверного признака» от «аккаунт создан только что»: перенос
    # старого локального флага применим только к первым (см. auth/onboarding.ts).
    created_at: datetime | None = None


class UserCreate(schemas.BaseUserCreate):
    """Registration payload (email + password auth).

    Deliberately NOT trimmed/empty-normalised like `UserUpdate.handle` below
    — that normalisation exists to support PATCH's "clear the field" use
    case (send `""`/whitespace to unset an already-set value), which has no
    equivalent at registration (there's nothing to clear yet; omit the
    field instead). A whitespace-only `handle` here is user-typed content,
    not a clear request, and falls straight into the name filter as such
    (see `app.services.auth._reject_bad_names`).
    """

    handle: str | None = Field(default=None, max_length=64)


class UserUpdate(schemas.BaseUserUpdate):
    """Self-service user update payload."""

    handle: str | None = Field(default=None, max_length=64)
    avatar_url: str | None = Field(default=None, max_length=512)
    method: SolvingMethod | None = None
    cubing_since_year: int | None = None

    @field_validator("cubing_since_year")
    @classmethod
    def _check_year(cls, value: int | None) -> int | None:
        return _validate_year(value)

    @field_validator("handle", mode="before")
    @classmethod
    def _clean_handle_update(cls, value: str | None) -> str | None:
        return _normalize_handle(value)
