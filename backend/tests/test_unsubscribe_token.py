"""`app.services.unsubscribe_token` — pure sign/verify + link building. No
DB, no clock. Mirrors `tests/test_duel_token.py`'s shape (if present) /
`app.services.duel_token`'s own test coverage pattern.
"""

import uuid

import pytest

from app.services.unsubscribe_token import UnsubscribeTokenError, build_links, sign, verify

SECRET = "unit-test-unsubscribe-secret-0123456789abcdef"
OTHER_SECRET = "a-totally-different-secret-0123456789abcdefzz"


def test_round_trip() -> None:
    user_id = uuid.uuid4()
    token = sign(user_id, 3, SECRET)
    verified = verify(token, SECRET)
    assert verified.user_id == user_id
    assert verified.token_version == 3


def test_tampered_signature_rejected() -> None:
    token = sign(uuid.uuid4(), 1, SECRET)
    payload_part, _sig_part = token.split(".", 1)
    tampered = f"{payload_part}.{'A' * 20}"
    with pytest.raises(UnsubscribeTokenError):
        verify(tampered, SECRET)


def test_wrong_secret_rejected() -> None:
    token = sign(uuid.uuid4(), 1, SECRET)
    with pytest.raises(UnsubscribeTokenError):
        verify(token, OTHER_SECRET)


def test_malformed_token_rejected() -> None:
    with pytest.raises(UnsubscribeTokenError):
        verify("not-a-real-token", SECRET)


def test_missing_dot_separator_rejected() -> None:
    with pytest.raises(UnsubscribeTokenError):
        verify("nodothere", SECRET)


def test_different_token_version_does_not_verify_as_matching() -> None:
    """`verify` itself doesn't compare against a "current" version — it
    just returns whatever was signed. Staleness is the CALLER's job (see
    `app.services.email_prefs.unsubscribe_by_token`) — this only proves the
    version travels through intact.
    """
    token = sign(uuid.uuid4(), 5, SECRET)
    verified = verify(token, SECRET)
    assert verified.token_version == 5


def test_build_links_shape() -> None:
    user_id = uuid.uuid4()
    links = build_links(user_id, 1, SECRET, "https://cubr-game.ru")
    assert links.page_url.startswith("https://cubr-game.ru/unsubscribe?token=")
    assert links.list_unsubscribe_post_url.startswith(
        "https://cubr-game.ru/api/email/unsubscribe?token="
    )
    # Both links carry a token that verifies back to the same user/version.
    page_token = links.page_url.split("token=", 1)[1]
    verified = verify(page_token, SECRET)
    assert verified.user_id == user_id
    assert verified.token_version == 1
