"""HMAC-signed duel WS session/reconnect tokens.

Mirrors ``app.services.scramble_token`` (same signed-payload shape, same
tamper-evident-not-secret posture) but binds to `(room_id, user_id)` instead
of `(scramble, event, nonce)`, and signs with the SEPARATE
``DUEL_SIGN_SECRET`` (blast-radius split from `SCRAMBLE_SIGN_SECRET`/`SECRET`/
`RESET_VERIFY_SECRET`).

Skeptic-hardened (HIGH#2 fix / CSWSH): the WS handshake in
``app.routers.duel`` requires BOTH a valid auth cookie (via
``app.services.ws_auth``) AND a token verified here whose embedded
`(room_id, user_id)` match the connecting request's path `room_id` and the
cookie-authenticated user's `id`. Binding `user_id` (not just `room_id`)
closes the leaked-invite-URL hole: without it, anyone who obtains the
`session_token` (e.g. a leaked join URL) and has ANY valid account could
authenticate their own cookie and reconnect AS one of the two real players —
binding `user_id` means their own cookie's `user.id` will never match the
token's embedded `user_id`, so verification alone isn't enough; the router
still separately checks the match (this module only proves the token itself
wasn't tampered with).
"""

import base64
import binascii
import hmac
import json
import time
import uuid
from dataclasses import dataclass


class DuelTokenError(ValueError):
    """Raised when a duel token fails to parse, verify, or is expired."""


@dataclass(frozen=True)
class VerifiedDuelSession:
    user_id: uuid.UUID
    room_id: uuid.UUID


def _b64url_encode(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def _b64url_decode(data: str) -> bytes:
    padding = "=" * (-len(data) % 4)
    return base64.urlsafe_b64decode(data + padding)


def sign(user_id: uuid.UUID, room_id: uuid.UUID, secret: str, ttl_seconds: int) -> str:
    """Return a signed token binding `user_id` to `room_id`, expiring after `ttl_seconds`."""
    payload = {
        "user_id": str(user_id),
        "room_id": str(room_id),
        "exp": int(time.time()) + ttl_seconds,
    }
    payload_bytes = json.dumps(payload, separators=(",", ":"), sort_keys=True).encode("utf-8")
    signature = hmac.new(secret.encode("utf-8"), payload_bytes, "sha256").digest()
    return f"{_b64url_encode(payload_bytes)}.{_b64url_encode(signature)}"


def verify(token: str, secret: str) -> VerifiedDuelSession:
    """Verify signature + expiry and return the embedded `(user_id, room_id)`.

    Raises `DuelTokenError` on a malformed token, a bad/tampered signature,
    an expired token, or an embedded id that isn't a valid UUID. Never raises
    anything else. Does NOT check the ids against a specific room/caller —
    the router does that comparison (see module docstring).
    """
    try:
        encoded_payload, encoded_signature = token.split(".", 1)
        payload_bytes = _b64url_decode(encoded_payload)
        signature = _b64url_decode(encoded_signature)
    except (ValueError, binascii.Error) as exc:
        raise DuelTokenError("Malformed duel token") from exc

    expected_signature = hmac.new(secret.encode("utf-8"), payload_bytes, "sha256").digest()
    if not hmac.compare_digest(signature, expected_signature):
        raise DuelTokenError("Invalid duel token signature")

    try:
        payload = json.loads(payload_bytes)
    except ValueError as exc:
        raise DuelTokenError("Malformed duel token payload") from exc

    if not isinstance(payload, dict):
        raise DuelTokenError("Malformed duel token payload")

    raw_user_id = payload.get("user_id")
    raw_room_id = payload.get("room_id")
    exp = payload.get("exp")
    if not isinstance(raw_user_id, str) or not isinstance(raw_room_id, str):
        raise DuelTokenError("Malformed duel token payload")
    if not isinstance(exp, int):
        raise DuelTokenError("Malformed duel token payload")

    if time.time() > exp:
        raise DuelTokenError("Duel token expired")

    try:
        user_id = uuid.UUID(raw_user_id)
        room_id = uuid.UUID(raw_room_id)
    except ValueError as exc:
        raise DuelTokenError("Malformed duel token payload") from exc

    return VerifiedDuelSession(user_id=user_id, room_id=room_id)
