from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator

# Positional cube faces (reader space), NOT color letters. The color_profile is
# keyed by these so read-time classification can consume it later.
CUBE_FACES = ("U", "R", "F", "D", "L", "B")

# A single Lab (or reader-space) colour reference: exactly 3 floats.
ColorTriple = tuple[float, float, float]
ColorProfile = dict[str, ColorTriple]


def _validate_color_profile(value: ColorProfile) -> ColorProfile:
    keys = set(value.keys())
    if keys != set(CUBE_FACES):
        raise ValueError(
            f"color_profile must have exactly the 6 face keys {sorted(CUBE_FACES)}, "
            f"got {sorted(keys)}"
        )
    for face, triple in value.items():
        if len(triple) != 3:
            raise ValueError(f"color_profile[{face!r}] must be exactly 3 floats")
    return value


class CubeCreate(BaseModel):
    """Inbound payload to register a cube profile."""

    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=64)
    note: str | None = Field(default=None, max_length=255)
    is_primary: bool = False
    color_profile: ColorProfile

    @field_validator("color_profile")
    @classmethod
    def _check_profile(cls, value: ColorProfile) -> ColorProfile:
        return _validate_color_profile(value)


class CubeUpdate(BaseModel):
    """Partial update: rename / re-note / (re)assign primary. Not color_profile."""

    model_config = ConfigDict(extra="forbid")

    name: str | None = Field(default=None, min_length=1, max_length=64)
    note: str | None = Field(default=None, max_length=255)
    is_primary: bool | None = None


class CubeRead(BaseModel):
    """Public representation of a persisted cube."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    name: str
    note: str | None
    is_primary: bool
    color_profile: ColorProfile
    created_at: datetime
    recalibrated_at: datetime
