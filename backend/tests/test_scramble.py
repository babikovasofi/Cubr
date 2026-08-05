import re

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.config import get_settings
from app.models import Scramble
from app.services.scramble import random_scramble
from app.services.scramble_token import ScrambleTokenError, sign, verify

_TOKEN_RE = re.compile(r"^[URFDLB]['2]?$")
_SECRET = "unit-test-scramble-token-signing-secret-0123456789"


async def test_scramble_returns_200_with_nonempty_string(client: AsyncClient) -> None:
    resp = await client.get("/scramble")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert isinstance(body["scramble"], str)
    assert body["scramble"] != ""
    assert body["event"] == "333"


async def test_scramble_is_public_without_auth_cookie(client: AsyncClient) -> None:
    # `client` never logs in — no auth cookie is set anywhere in this test.
    resp = await client.get("/scramble")
    assert resp.status_code == 200, resp.text


async def test_scramble_response_includes_a_verifiable_token(client: AsyncClient) -> None:
    resp = await client.get("/scramble")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    token = body["scramble_token"]
    assert isinstance(token, str) and token != ""

    verified = verify(token, get_settings().SCRAMBLE_SIGN_SECRET)
    assert verified.scramble == body["scramble"]
    assert verified.event == body["event"]


async def test_scramble_get_writes_no_scrambles_row(
    client: AsyncClient, session_maker: async_sessionmaker[AsyncSession]
) -> None:
    # Stateless issuance: repeated GETs must never touch the `scrambles`
    # table — only POST /solves lazily persists a row.
    await client.get("/scramble")
    await client.get("/scramble")

    async with session_maker() as session:
        rows = (await session.execute(select(Scramble))).scalars().all()
    assert rows == []


def test_random_scramble_tokens_are_valid_and_no_immediate_repeat() -> None:
    for _ in range(200):
        scramble = random_scramble()
        tokens = scramble.split(" ")
        assert len(tokens) == 25
        prev_face = ""
        for token in tokens:
            assert _TOKEN_RE.match(token), f"invalid token: {token!r}"
            face = token[0]
            assert face != prev_face, f"repeated face back-to-back: {scramble!r}"
            prev_face = face


def test_random_scramble_is_not_constant() -> None:
    a = random_scramble()
    b = random_scramble()
    assert a != b


# --- scramble_token: sign/verify ---------------------------------------------


def test_scramble_token_round_trips() -> None:
    token = sign("R U R' U'", "333", _SECRET, ttl_seconds=3600)
    verified = verify(token, _SECRET)
    assert verified.scramble == "R U R' U'"
    assert verified.event == "333"
    assert verified.nonce != ""


def test_scramble_token_nonce_is_fresh_per_sign() -> None:
    first = verify(sign("R U", "333", _SECRET, ttl_seconds=3600), _SECRET)
    second = verify(sign("R U", "333", _SECRET, ttl_seconds=3600), _SECRET)
    assert first.nonce != second.nonce


def test_scramble_token_expired_raises() -> None:
    token = sign("R U R' U'", "333", _SECRET, ttl_seconds=-1)
    with pytest.raises(ScrambleTokenError):
        verify(token, _SECRET)


def test_scramble_token_tampered_signature_raises() -> None:
    token = sign("R U R' U'", "333", _SECRET, ttl_seconds=3600)
    payload_part, _sig = token.split(".", 1)
    tampered = f"{payload_part}.not-the-real-signature-at-all"
    with pytest.raises(ScrambleTokenError):
        verify(tampered, _SECRET)


def test_scramble_token_wrong_secret_raises() -> None:
    token = sign("R U R' U'", "333", _SECRET, ttl_seconds=3600)
    with pytest.raises(ScrambleTokenError):
        verify(token, "a-completely-different-signing-secret-value")


def test_scramble_token_malformed_string_raises() -> None:
    with pytest.raises(ScrambleTokenError):
        verify("not-a-valid-token-at-all", _SECRET)
