"""Pure, DB-agnostic helpers for the ``0013_single_user_handle`` migration.

Deriving a single ``User.handle`` from the old ``nickname``/``public_handle``
pair, and making the result unique, is genuine data-migration LOGIC — not
just DDL — so it lives here as ordinary importable functions instead of
being inlined in the migration file. That is what makes it unit-testable
(see ``tests/test_handle_backfill.py``); the migration itself
(``migrations/versions/0013_single_user_handle.py``) only wires these
functions to the database rows.

Deliberately independent of ``app.services.moderation``: a migration must
never invent a NEW rejection for a name a live user already had (the
profanity/reserved-word filter only applies to names people TYPE from now
on), so this module only strips characters the app would never have
accepted in the first place — it does not run the profanity/reserved-name
check.
"""

import re

# Mirrors app.services.moderation._ALLOWED_RE's character class (letters,
# digits, space, underscore, dot, hyphen). Anything else is DROPPED, not
# rejected — a migration cannot ask the user to retype their name.
_DISALLOWED_RE = re.compile(r"[^A-Za-zА-Яа-яЁё0-9 _.\-]+")
_WHITESPACE_RE = re.compile(r"\s+")

MAX_LENGTH = 64
MIN_LENGTH = 2


def sanitize_handle_chars(value: str) -> str:
    """Strip characters ``check_display_name`` would reject, collapse
    whitespace, trim. Does NOT enforce length or run the profanity/reserved
    filter — see the module docstring for why.
    """
    stripped = _DISALLOWED_RE.sub("", value)
    collapsed = _WHITESPACE_RE.sub(" ", stripped)
    return collapsed.strip()


def derive_handle(nickname: str | None, public_handle: str | None) -> str | None:
    """One handle out of the old two, or ``None`` if neither survives.

    Prefers ``public_handle`` (it was already the public/unique-intent
    field — "если public_handle заполнен — берём его"); falls back to a
    sanitised ``nickname`` ("иначе выводим из nickname, приводя к допустимым
    символам"). Returns ``None`` when both are unset, or both sanitise to
    nothing (e.g. an emoji-only name) — a migration should not fabricate an
    identity for someone who never chose one; the row keeps the same
    "no handle yet" state a fresh password sign-up already has.
    """
    for candidate in (public_handle, nickname):
        if not candidate:
            continue
        cleaned = sanitize_handle_chars(candidate)
        if len(cleaned) >= MIN_LENGTH:
            return cleaned[:MAX_LENGTH]
    return None


def dedupe_handle(candidate: str, taken_lower: set[str]) -> str:
    """Append a numeric suffix until ``candidate`` is free, case-insensitively,
    respecting the 64-char column limit ("при коллизии — суффикс").

    Pure: does not mutate ``taken_lower``. The caller adds the winner to the
    set once it commits to writing that row, so the NEXT row's dedupe sees
    it too.
    """
    if candidate.lower() not in taken_lower:
        return candidate
    n = 2
    while True:
        suffix = str(n)
        base = candidate[: MAX_LENGTH - len(suffix)]
        attempt = f"{base}{suffix}"
        if attempt.lower() not in taken_lower:
            return attempt
        n += 1
