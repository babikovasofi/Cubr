"""Duel WS integration tests (sync `TestClient` + in-memory sqlite).

Drives the real `/duel/ws/{room_id}` route end-to-end: the CSWSH-hardened
handshake (Origin + cookie + `(room_id,user_id)`-bound token), the shared
scramble reveal, status relay, result computation, and reconnect snapshot.

The module-level `manager` singleton in `app.routers.duel` is shared across
the process; each test uses fresh accounts/rooms and closes its sockets, so
`RoomState` is torn down between tests. Where a test needs the countdown to
elapse quickly it shrinks that one interval on the singleton via monkeypatch.
"""

import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

_ORIGIN = "http://localhost:5173"
_HEADERS = {"origin": _ORIGIN}
_PW = "correcthorsebatterystaple123"


def _register_and_login(tc: TestClient, email: str) -> str:
    r = tc.post("/auth/register", json={"email": email, "password": _PW})
    assert r.status_code == 201, r.text
    r = tc.post("/auth/login", data={"username": email, "password": _PW})
    assert r.status_code == 204, r.text
    cookie = tc.cookies.get("cubr_auth")
    assert cookie
    return cookie


def _make_duel(tc: TestClient, suffix: str) -> dict:
    """Two fresh users -> a full room. Returns ids/tokens/cookies for both."""
    cookie_a = _register_and_login(tc, f"wsa_{suffix}@example.com")
    created = tc.post("/duel/rooms").json()
    tc.cookies.clear()
    cookie_b = _register_and_login(tc, f"wsb_{suffix}@example.com")
    joined = tc.post(f"/duel/join/{created['invite_token']}").json()
    tc.cookies.clear()
    return {
        "room_id": created["room_id"],
        "token_a": created["session_token"],
        "token_b": joined["session_token"],
        "cookie_a": cookie_a,
        "cookie_b": cookie_b,
    }


def _create_room_only(sync_client: TestClient, suffix: str) -> dict:
    """One fresh user creates a room and does NOT wait for an opponent."""
    cookie_a = _register_and_login(sync_client, f"solo_{suffix}@example.com")
    created = sync_client.post("/duel/rooms").json()
    sync_client.cookies.clear()
    return {
        "room_id": created["room_id"],
        "token_a": created["session_token"],
        "invite_token": created["invite_token"],
        "cookie_a": cookie_a,
    }


def _recv_until(ws: object, msg_type: str, budget: int = 12) -> dict:
    for _ in range(budget):
        msg = ws.receive_json()  # type: ignore[attr-defined]
        if msg["type"] == msg_type:
            return msg
    raise AssertionError(f"never received {msg_type!r}")


# --------------------------------------------------------------------------- #
# handshake auth
# --------------------------------------------------------------------------- #


def test_connect_without_cookie_closes_4401(sync_client: TestClient) -> None:
    duel = _make_duel(sync_client, "nocookie")
    sync_client.cookies.clear()  # anonymous
    with sync_client.websocket_connect(
        f"/duel/ws/{duel['room_id']}?token={duel['token_a']}", headers=_HEADERS
    ) as ws:
        with pytest.raises(WebSocketDisconnect) as exc:
            ws.receive_json()
    assert exc.value.code == 4401


def test_connect_with_foreign_origin_closes_4403(sync_client: TestClient) -> None:
    duel = _make_duel(sync_client, "badorigin")
    sync_client.cookies.set("cubr_auth", duel["cookie_a"])
    with sync_client.websocket_connect(
        f"/duel/ws/{duel['room_id']}?token={duel['token_a']}",
        headers={"origin": "https://evil.example.com"},
    ) as ws:
        with pytest.raises(WebSocketDisconnect) as exc:
            ws.receive_json()
    assert exc.value.code == 4403
    sync_client.cookies.clear()


def test_connect_with_token_for_other_user_closes_4401(sync_client: TestClient) -> None:
    # b's cookie but a's token -> the (room_id,user_id) binding mismatches.
    duel = _make_duel(sync_client, "wrongtoken")
    sync_client.cookies.set("cubr_auth", duel["cookie_b"])
    with sync_client.websocket_connect(
        f"/duel/ws/{duel['room_id']}?token={duel['token_a']}", headers=_HEADERS
    ) as ws:
        with pytest.raises(WebSocketDisconnect) as exc:
            ws.receive_json()
    assert exc.value.code == 4401
    sync_client.cookies.clear()


# --------------------------------------------------------------------------- #
# lone creator waits (regression: open room must NOT close 4404)
# --------------------------------------------------------------------------- #


def test_creator_can_hold_socket_while_room_open(sync_client: TestClient) -> None:
    # Regression for the reviewer's HIGH: player_a opens a WS immediately after
    # POST /duel/rooms (room still `open`, player_b unknown). The old 4404 gate
    # dropped this socket into a reconnect loop; now it must stay connected and
    # a `join` returns a waiting_opponent snapshot.
    room = _create_room_only(sync_client, "solo")
    sync_client.cookies.set("cubr_auth", room["cookie_a"])
    with sync_client.websocket_connect(
        f"/duel/ws/{room['room_id']}?token={room['token_a']}", headers=_HEADERS
    ) as ws_a:
        ws_a.send_json({"type": "join"})
        snap = _recv_until(ws_a, "room_state")
        assert snap["phase"] == "waiting_opponent"
        assert snap["opponent_present"] is False
        assert snap["scramble"] is None
        # ping is answered (heartbeat keepalive works on a lone socket)
        ws_a.send_json({"type": "ping"})
        assert _recv_until(ws_a, "pong")["type"] == "pong"
    sync_client.cookies.clear()


def test_opponent_arrival_pushes_start_to_already_waiting_creator(
    sync_client: TestClient,
) -> None:
    # Realtime path: A connects and waits (only A in the room), THEN B's socket
    # arrives and triggers activation — the already-waiting A must receive the
    # `start` broadcast, not just B. (All REST done up front; a REST call inside
    # an open WS context corrupts the sync TestClient.)
    duel = _make_duel(sync_client, "activate")

    sync_client.cookies.set("cubr_auth", duel["cookie_a"])
    with sync_client.websocket_connect(
        f"/duel/ws/{duel['room_id']}?token={duel['token_a']}", headers=_HEADERS
    ) as ws_a:
        ws_a.send_json({"type": "join"})
        # A alone -> waiting (B has REST-joined but hasn't opened a socket).
        assert _recv_until(ws_a, "room_state")["phase"] == "waiting_opponent"

        sync_client.cookies.set("cubr_auth", duel["cookie_b"])
        with sync_client.websocket_connect(
            f"/duel/ws/{duel['room_id']}?token={duel['token_b']}", headers=_HEADERS
        ) as ws_b:
            start_a = _recv_until(ws_a, "start")  # pushed to the waiting creator
            start_b = _recv_until(ws_b, "start")
            assert start_a["scramble"] == start_b["scramble"]
    sync_client.cookies.clear()


# --------------------------------------------------------------------------- #
# shared scramble + secrecy
# --------------------------------------------------------------------------- #


def test_both_receive_identical_scramble_and_rest_hides_it(sync_client: TestClient) -> None:
    duel = _make_duel(sync_client, "scramble")

    sync_client.cookies.set("cubr_auth", duel["cookie_a"])
    with sync_client.websocket_connect(
        f"/duel/ws/{duel['room_id']}?token={duel['token_a']}", headers=_HEADERS
    ) as ws_a:
        sync_client.cookies.set("cubr_auth", duel["cookie_b"])
        with sync_client.websocket_connect(
            f"/duel/ws/{duel['room_id']}?token={duel['token_b']}", headers=_HEADERS
        ) as ws_b:
            start_a = _recv_until(ws_a, "start")
            start_b = _recv_until(ws_b, "start")
            assert start_a["scramble"] == start_b["scramble"]
            assert start_a["scramble"]

            # REST bootstrap NEVER leaks the scramble.
            sync_client.cookies.set("cubr_auth", duel["cookie_a"])
            room_read = sync_client.get(f"/duel/rooms/{duel['room_id']}").json()
            assert "scramble" not in room_read
    sync_client.cookies.clear()


# --------------------------------------------------------------------------- #
# status relay + result
# --------------------------------------------------------------------------- #


def _play_to_result(sync_client: TestClient, duel: dict, a_finish: dict, b_finish: dict) -> dict:
    """Connect both, ready both, submit both finishes, return a's `result`."""
    sync_client.cookies.set("cubr_auth", duel["cookie_a"])
    with sync_client.websocket_connect(
        f"/duel/ws/{duel['room_id']}?token={duel['token_a']}", headers=_HEADERS
    ) as ws_a:
        sync_client.cookies.set("cubr_auth", duel["cookie_b"])
        with sync_client.websocket_connect(
            f"/duel/ws/{duel['room_id']}?token={duel['token_b']}", headers=_HEADERS
        ) as ws_b:
            _recv_until(ws_a, "start")
            _recv_until(ws_b, "start")

            ws_a.send_json({"type": "status_update", "phase": "ready"})
            assert _recv_until(ws_b, "status_update")["player"] == "a"
            ws_b.send_json({"type": "status_update", "phase": "ready"})
            _recv_until(ws_a, "countdown")

            ws_a.send_json({"type": "finish", **a_finish})
            ws_b.send_json({"type": "finish", **b_finish})
            result = _recv_until(ws_a, "result")
    sync_client.cookies.clear()
    return result


def test_status_update_relayed_to_opponent(sync_client: TestClient) -> None:
    duel = _make_duel(sync_client, "status")
    sync_client.cookies.set("cubr_auth", duel["cookie_a"])
    with sync_client.websocket_connect(
        f"/duel/ws/{duel['room_id']}?token={duel['token_a']}", headers=_HEADERS
    ) as ws_a:
        sync_client.cookies.set("cubr_auth", duel["cookie_b"])
        with sync_client.websocket_connect(
            f"/duel/ws/{duel['room_id']}?token={duel['token_b']}", headers=_HEADERS
        ) as ws_b:
            _recv_until(ws_a, "start")
            _recv_until(ws_b, "start")
            ws_a.send_json({"type": "status_update", "phase": "ready"})
            relayed = _recv_until(ws_b, "status_update")
            assert relayed == {"type": "status_update", "player": "a", "phase": "ready"}
    sync_client.cookies.clear()


def test_result_smaller_valid_time_wins(sync_client: TestClient) -> None:
    duel = _make_duel(sync_client, "valid")
    result = _play_to_result(
        sync_client,
        duel,
        {"time_ms": 4000, "dnf": False, "verify_frames_ok": True},
        {"time_ms": 7000, "dnf": False, "verify_frames_ok": True},
    )
    # winner is the player with 4000 ms (slot a).
    winner = result["winner_id"]
    a_player = next(p for p in result["players"] if p["slot"] == "a")
    assert a_player["time_ms"] == 4000
    assert winner is not None


def test_result_valid_beats_dnf(sync_client: TestClient) -> None:
    duel = _make_duel(sync_client, "vdnf")
    result = _play_to_result(
        sync_client,
        duel,
        {"time_ms": 5000, "dnf": False, "verify_frames_ok": True},
        {"time_ms": 1, "dnf": True, "verify_frames_ok": False},
    )
    b_player = next(p for p in result["players"] if p["slot"] == "b")
    assert b_player["status"] == "dnf"
    assert result["winner_id"] is not None  # a wins


def test_result_both_dnf_is_tie(sync_client: TestClient) -> None:
    duel = _make_duel(sync_client, "bothdnf")
    result = _play_to_result(
        sync_client,
        duel,
        {"time_ms": 1, "dnf": True, "verify_frames_ok": False},
        {"time_ms": 1, "dnf": True, "verify_frames_ok": False},
    )
    assert result["winner_id"] is None


# --------------------------------------------------------------------------- #
# reconnect snapshot
# --------------------------------------------------------------------------- #


def test_reconnect_join_returns_room_state_with_scramble(sync_client: TestClient) -> None:
    duel = _make_duel(sync_client, "reconnect")

    # B is the stable connection kept open for the whole test; A drops mid-prep
    # (room stays alive during the 60s disconnect grace) and reconnects.
    sync_client.cookies.set("cubr_auth", duel["cookie_b"])
    with sync_client.websocket_connect(
        f"/duel/ws/{duel['room_id']}?token={duel['token_b']}", headers=_HEADERS
    ) as ws_b:
        sync_client.cookies.set("cubr_auth", duel["cookie_a"])
        with sync_client.websocket_connect(
            f"/duel/ws/{duel['room_id']}?token={duel['token_a']}", headers=_HEADERS
        ) as ws_a:
            scramble = _recv_until(ws_a, "start")["scramble"]
            _recv_until(ws_b, "start")
        # A disconnected here (inner block exit).

        # A reconnects with the SAME session token and requests a snapshot.
        sync_client.cookies.set("cubr_auth", duel["cookie_a"])
        with sync_client.websocket_connect(
            f"/duel/ws/{duel['room_id']}?token={duel['token_a']}", headers=_HEADERS
        ) as ws_a2:
            ws_a2.send_json({"type": "join"})
            snap = _recv_until(ws_a2, "room_state")
            assert snap["scramble"] == scramble
            assert snap["phase"] == "preparing"
    sync_client.cookies.clear()
