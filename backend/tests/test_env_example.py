"""`.env.example` is the only list of settings a deploy is configured from.

A setting added to `app/config.py` with a default that is fine locally and wrong
in production (a rate limit, a window, an allowlist) is invisible until it
misbehaves on the real site. Keeping the file in lockstep with the model is
mechanical, so a test does it instead of a reviewer.
"""

from pathlib import Path

from app.config import Settings

ENV_EXAMPLE = Path(__file__).resolve().parent.parent / ".env.example"


def _documented_keys() -> set[str]:
    keys: set[str] = set()
    for line in ENV_EXAMPLE.read_text(encoding="utf-8").splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#") or "=" not in stripped:
            continue
        keys.add(stripped.split("=", 1)[0].strip())
    return keys


def test_every_setting_appears_in_env_example() -> None:
    missing = sorted(set(Settings.model_fields) - _documented_keys())
    assert not missing, (
        f".env.example is missing {missing}. Add a line per setting (with a "
        "`# prod:` note if the local default is wrong in production)."
    )


def test_env_example_documents_no_unknown_setting() -> None:
    """The other direction: a renamed or deleted setting leaves a stale line
    that reads like live configuration and silently does nothing."""
    unknown = sorted(_documented_keys() - set(Settings.model_fields))
    assert not unknown, f".env.example documents settings app/config.py does not read: {unknown}"
