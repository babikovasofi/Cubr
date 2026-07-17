"""HMAC-signed, one-time-use scramble tokens.

Stateless authenticity for ``GET /scramble``: the server signs the scramble
text, event, a random nonce, and an expiry into a compact token — no DB write
on issuance. ``POST /solves`` verifies the signature (tamper-evident: the
client's own ``scramble`` field can never be trusted) and consumes the nonce
(one-time-use, enforced by a DB unique constraint on ``scrambles.nonce``)
before persisting anything.

Token format: ``base64url(json_payload) + "." + base64url(hmac_sha256(payload_bytes))``.
The payload is signed, not encrypted — it is not secret, only tamper-evident.
"""

import base64
import binascii
import hmac
import json
import secrets
import time
from dataclasses import dataclass


class ScrambleTokenError(ValueError):
    """Raised when a scramble token fails to parse, verify, or is expired."""


@dataclass(frozen=True)
class VerifiedScramble:
    scramble: str
    event: str
    nonce: str


def _b64url_encode(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def _b64url_decode(data: str) -> bytes:
    padding = "=" * (-len(data) % 4)
    return base64.urlsafe_b64decode(data + padding)


def sign(scramble: str, event: str, secret: str, ttl_seconds: int) -> str:
    """Return a signed token embedding ``scramble``/``event``/a fresh nonce/expiry."""
    payload = {
        "scramble": scramble,
        "event": event,
        "nonce": secrets.token_urlsafe(24),
        "exp": int(time.time()) + ttl_seconds,
    }
    payload_bytes = json.dumps(payload, separators=(",", ":"), sort_keys=True).encode("utf-8")
    signature = hmac.new(secret.encode("utf-8"), payload_bytes, "sha256").digest()
    return f"{_b64url_encode(payload_bytes)}.{_b64url_encode(signature)}"


def verify(token: str, secret: str) -> VerifiedScramble:
    """Verify signature + expiry and return the embedded scramble/event/nonce.

    Raises ``ScrambleTokenError`` on a malformed token, a bad/tampered
    signature, or an expired token. Never raises anything else.
    """
    try:
        encoded_payload, encoded_signature = token.split(".", 1)
        payload_bytes = _b64url_decode(encoded_payload)
        signature = _b64url_decode(encoded_signature)
    except (ValueError, binascii.Error) as exc:
        raise ScrambleTokenError("Malformed scramble token") from exc

    expected_signature = hmac.new(secret.encode("utf-8"), payload_bytes, "sha256").digest()
    if not hmac.compare_digest(signature, expected_signature):
        raise ScrambleTokenError("Invalid scramble token signature")

    try:
        payload = json.loads(payload_bytes)
    except ValueError as exc:
        raise ScrambleTokenError("Malformed scramble token payload") from exc

    if not isinstance(payload, dict):
        raise ScrambleTokenError("Malformed scramble token payload")

    scramble = payload.get("scramble")
    event = payload.get("event")
    nonce = payload.get("nonce")
    exp = payload.get("exp")
    if (
        not isinstance(scramble, str)
        or not isinstance(event, str)
        or not isinstance(nonce, str)
        or not isinstance(exp, int)
    ):
        raise ScrambleTokenError("Malformed scramble token payload")

    if time.time() > exp:
        raise ScrambleTokenError("Scramble token expired")

    return VerifiedScramble(scramble=scramble, event=event, nonce=nonce)
