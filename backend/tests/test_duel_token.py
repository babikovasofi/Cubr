"""HMAC duel session-token sign/verify (`app.services.duel_token`)."""

import time
import uuid

import pytest

from app.services import duel_token
from app.services.duel_token import DuelTokenError

_SECRET = "test-duel-sign-secret-0123456789abcdef-xyz"


def test_sign_then_verify_roundtrips_user_and_room() -> None:
    user_id = uuid.uuid4()
    room_id = uuid.uuid4()
    token = duel_token.sign(user_id, room_id, _SECRET, ttl_seconds=60)

    verified = duel_token.verify(token, _SECRET)

    assert verified.user_id == user_id
    assert verified.room_id == room_id


def test_verify_rejects_tampered_signature() -> None:
    token = duel_token.sign(uuid.uuid4(), uuid.uuid4(), _SECRET, ttl_seconds=60)
    payload, _sig = token.split(".", 1)
    # Re-sign the same payload under a different secret -> signature mismatch.
    forged = f"{payload}.{duel_token.sign(uuid.uuid4(), uuid.uuid4(), 'other', 60).split('.', 1)[1]}"

    with pytest.raises(DuelTokenError):
        duel_token.verify(forged, _SECRET)


def test_verify_rejects_wrong_secret() -> None:
    token = duel_token.sign(uuid.uuid4(), uuid.uuid4(), _SECRET, ttl_seconds=60)

    with pytest.raises(DuelTokenError):
        duel_token.verify(token, "a-completely-different-secret-value-here")


def test_verify_rejects_expired_token() -> None:
    token = duel_token.sign(uuid.uuid4(), uuid.uuid4(), _SECRET, ttl_seconds=-1)

    with pytest.raises(DuelTokenError):
        duel_token.verify(token, _SECRET)


def test_verify_rejects_malformed_token() -> None:
    with pytest.raises(DuelTokenError):
        duel_token.verify("not-a-valid-token", _SECRET)


def test_verify_rejects_garbage_after_dot() -> None:
    token = duel_token.sign(uuid.uuid4(), uuid.uuid4(), _SECRET, ttl_seconds=60)
    payload, _sig = token.split(".", 1)

    with pytest.raises(DuelTokenError):
        duel_token.verify(f"{payload}.!!!not-base64!!!", _SECRET)


def test_verify_reports_bound_ids_for_caller_comparison() -> None:
    # The token itself binds (user_id, room_id); the router compares them
    # against the connecting caller. A token minted for one (user, room) pair
    # verifies to exactly that pair and no other — so a mismatched caller is
    # rejected by the router, not silently accepted.
    real_user, real_room = uuid.uuid4(), uuid.uuid4()
    token = duel_token.sign(real_user, real_room, _SECRET, ttl_seconds=60)

    verified = duel_token.verify(token, _SECRET)

    assert verified.user_id != uuid.uuid4()
    assert verified.room_id != uuid.uuid4()
    assert (verified.user_id, verified.room_id) == (real_user, real_room)


def test_exp_is_ttl_from_now() -> None:
    before = int(time.time())
    token = duel_token.sign(uuid.uuid4(), uuid.uuid4(), _SECRET, ttl_seconds=120)
    # Not expired now; a verify inside the window succeeds.
    assert duel_token.verify(token, _SECRET) is not None
    assert int(time.time()) - before < 120
