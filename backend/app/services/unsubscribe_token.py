"""HMAC-signed chat-email unsubscribe tokens + the two links built from them.

Mirrors `app.services.duel_token` (same signed-payload shape, same
tamper-evident-not-secret posture) but binds to `(user_id, "chat",
token_version)` instead of `(user_id, room_id)`, and signs with the
SEPARATE `UNSUBSCRIBE_SIGN_SECRET` (blast-radius split from `SECRET`/
`RESET_VERIFY_SECRET`/`SCRAMBLE_SIGN_SECRET`/`DUEL_SIGN_SECRET`).

`"chat"` is embedded (not just implied by which secret verified it) so a
second notification channel added later can share this secret without its
tokens being interchangeable with chat's.

No `exp` field, unlike `duel_token`: an unsubscribe link has no natural
session-length TTL, and the plan's actual invalidation mechanism is
`token_version` — every unsubscribe AND every re-subscribe bumps it (see
`app.models.chat.EmailPrefs`), which kills every link signed against the
old version, including ones still sitting unopened in someone's inbox.

This is the ONE place both the Этап B sweep job (which puts a link in the
email it sends) and the `/email/*` router (which verifies a link someone
clicked) build/parse this token — see the plan's closing instruction:
"нужен единой helper".
"""

import base64
import binascii
import hmac
import json
import uuid
from dataclasses import dataclass
from urllib.parse import quote

_PURPOSE = "chat"


class UnsubscribeTokenError(ValueError):
    """Raised when an unsubscribe token fails to parse or verify."""


@dataclass(frozen=True)
class VerifiedUnsubscribeToken:
    user_id: uuid.UUID
    token_version: int


@dataclass(frozen=True)
class UnsubscribeLinks:
    """The two links a chat-notification email needs (plan §7B):

    `page_url` — the frontend `/unsubscribe?token=` page a human clicks (has
    a button; does NOT unsubscribe on its own GET load — mail clients
    prefetch links). `list_unsubscribe_post_url` — the backend
    `/email/unsubscribe?token=` URL a mail client's one-click button POSTs
    to directly (RFC 8058); goes in the `List-Unsubscribe` header alongside
    `list_unsubscribe_mailto`.
    """

    page_url: str
    list_unsubscribe_post_url: str


def _b64url_encode(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def _b64url_decode(data: str) -> bytes:
    padding = "=" * (-len(data) % 4)
    return base64.urlsafe_b64decode(data + padding)


def sign(user_id: uuid.UUID, token_version: int, secret: str) -> str:
    """Return a signed token binding `(user_id, "chat", token_version)`."""
    payload = {
        "user_id": str(user_id),
        "purpose": _PURPOSE,
        "token_version": token_version,
    }
    payload_bytes = json.dumps(payload, separators=(",", ":"), sort_keys=True).encode("utf-8")
    signature = hmac.new(secret.encode("utf-8"), payload_bytes, "sha256").digest()
    return f"{_b64url_encode(payload_bytes)}.{_b64url_encode(signature)}"


def verify(token: str, secret: str) -> VerifiedUnsubscribeToken:
    """Verify signature + shape and return the embedded `(user_id,
    token_version)`. Raises `UnsubscribeTokenError` on a malformed token, a
    bad/tampered signature, a wrong `purpose`, or an embedded id that isn't
    a valid UUID. Never raises anything else. Does NOT compare
    `token_version` against the current DB row — the caller does that (an
    outdated version is "expired", not "malformed").
    """
    try:
        encoded_payload, encoded_signature = token.split(".", 1)
        payload_bytes = _b64url_decode(encoded_payload)
        signature = _b64url_decode(encoded_signature)
    except (ValueError, binascii.Error) as exc:
        raise UnsubscribeTokenError("Malformed unsubscribe token") from exc

    expected_signature = hmac.new(secret.encode("utf-8"), payload_bytes, "sha256").digest()
    if not hmac.compare_digest(signature, expected_signature):
        raise UnsubscribeTokenError("Invalid unsubscribe token signature")

    try:
        payload = json.loads(payload_bytes)
    except ValueError as exc:
        raise UnsubscribeTokenError("Malformed unsubscribe token payload") from exc

    if not isinstance(payload, dict):
        raise UnsubscribeTokenError("Malformed unsubscribe token payload")

    raw_user_id = payload.get("user_id")
    purpose = payload.get("purpose")
    token_version = payload.get("token_version")
    if not isinstance(raw_user_id, str):
        raise UnsubscribeTokenError("Malformed unsubscribe token payload")
    if purpose != _PURPOSE:
        raise UnsubscribeTokenError("Wrong unsubscribe token purpose")
    if not isinstance(token_version, int):
        raise UnsubscribeTokenError("Malformed unsubscribe token payload")

    try:
        user_id = uuid.UUID(raw_user_id)
    except ValueError as exc:
        raise UnsubscribeTokenError("Malformed unsubscribe token payload") from exc

    return VerifiedUnsubscribeToken(user_id=user_id, token_version=token_version)


def build_links(
    user_id: uuid.UUID, token_version: int, secret: str, frontend_url: str
) -> UnsubscribeLinks:
    """Build both unsubscribe links from one signed token. `frontend_url` is
    the single origin the whole app is served from (Caddy proxies `/api/*`
    to this backend on that same origin — see `docs/deploy.md` §"Фронт и API
    живут на одном origin") — mirrors how `app.services.email` already
    builds `{FRONTEND_URL}/verify?token=...`.
    """
    token = sign(user_id, token_version, secret)
    encoded = quote(token, safe="")
    return UnsubscribeLinks(
        page_url=f"{frontend_url}/unsubscribe?token={encoded}",
        list_unsubscribe_post_url=f"{frontend_url}/api/email/unsubscribe?token={encoded}",
    )
