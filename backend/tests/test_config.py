import pytest
from pydantic import ValidationError

from app.config import Settings

_GOOD = "kQ7m2Zt9v-config-test-key-0123456789abcdefghij"


def _make(**over: str) -> Settings:
    base = {"SECRET": _GOOD, "RESET_VERIFY_SECRET": _GOOD + "-2"}
    base.update(over)
    # _env_file=None → ignore any local .env so the test is hermetic.
    # arg-type: BaseSettings absorbs field kwargs via **values, but mypy checks a
    # spread dict against the named settings-source params first.
    return Settings(_env_file=None, **base)  # type: ignore[arg-type]


def test_real_secrets_boot() -> None:
    s = _make()
    assert s.SECRET == _GOOD


def test_missing_secret_fails_closed(monkeypatch: pytest.MonkeyPatch) -> None:
    # conftest seeds SECRET into os.environ; remove it so "unset" is real.
    monkeypatch.delenv("SECRET", raising=False)
    with pytest.raises(ValidationError):
        Settings(_env_file=None, RESET_VERIFY_SECRET=_GOOD)


def test_short_secret_rejected() -> None:
    with pytest.raises(ValidationError):
        _make(SECRET="too-short")


@pytest.mark.parametrize("env", ["local", "production"])
def test_placeholder_secret_rejected_in_every_env(env: str) -> None:
    # Padded to >=32 so it clears min_length; the fragment check must still catch it,
    # even in local — a forgotten APP_ENV must not boot with .env.example placeholders.
    with pytest.raises(ValidationError, match="placeholder"):
        _make(SECRET="change-me-padded-to-at-least-32-characters", APP_ENV=env)


def test_cookie_secure_derives_from_env() -> None:
    assert _make(APP_ENV="local").cookie_secure is False
    assert _make(APP_ENV="production").cookie_secure is True
