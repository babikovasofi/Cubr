"""In-memory realtime core unit tests (`app.services.duel_manager`).

No DB, no real sockets: fake `send_json` sinks + fake persistence callbacks +
tiny injected timeouts so timeout/heartbeat paths run in milliseconds.
"""

import asyncio
import uuid
from datetime import datetime, timezone

import pytest

from app.services.duel import PlayerOutcome, compute_winner
from app.services.duel_manager import ConnectionManager

pytestmark = pytest.mark.asyncio


class FakeSocket:
    def __init__(self) -> None:
        self.sent: list[dict] = []

    async def send_json(self, data: dict) -> None:
        self.sent.append(data)

    def types(self) -> list[str]:
        return [m["type"] for m in self.sent]

    def last(self, msg_type: str) -> dict:
        for m in reversed(self.sent):
            if m["type"] == msg_type:
                return m
        raise AssertionError(f"no {msg_type} in {self.types()}")

    def has(self, msg_type: str) -> bool:
        return any(m["type"] == msg_type for m in self.sent)


class Callbacks:
    def __init__(self) -> None:
        self.activate: list[tuple[uuid.UUID, str]] = []
        self.finalize: list[tuple[uuid.UUID, PlayerOutcome, PlayerOutcome]] = []
        self.abandon: list[uuid.UUID] = []

    async def on_activate(self, room_id: uuid.UUID, scramble: str) -> None:
        self.activate.append((room_id, scramble))

    async def on_finalize(
        self, room_id: uuid.UUID, a: PlayerOutcome, b: PlayerOutcome
    ) -> uuid.UUID | None:
        self.finalize.append((room_id, a, b))
        # Mirror production wiring: winner comes from the pure compute_winner.
        return compute_winner(
            a.user_id,
            a.status,
            a.time_ms,
            a.finished_at,
            b.user_id,
            b.status,
            b.time_ms,
            b.finished_at,
        )

    async def on_abandon(self, room_id: uuid.UUID) -> None:
        self.abandon.append(room_id)


def make_manager(cb: Callbacks, **overrides: float) -> ConnectionManager:
    params: dict[str, float] = {
        "prep_timeout_seconds": 0.05,
        "solve_timeout_seconds": 0.05,
        "disconnect_grace_seconds": 0.05,
        "heartbeat_interval_seconds": 0.02,
        "heartbeat_timeout_seconds": 0.05,
        "countdown_seconds": 0.02,
    }
    params.update(overrides)
    return ConnectionManager(
        on_activate=cb.on_activate,
        on_finalize=cb.on_finalize,
        on_abandon=cb.on_abandon,
        **params,
    )


async def _connect_both(
    mgr: ConnectionManager, room_id: uuid.UUID, a: uuid.UUID, b: uuid.UUID
) -> tuple[FakeSocket, FakeSocket]:
    sa, sb = FakeSocket(), FakeSocket()
    await mgr.connect(room_id, a, player_a_id=a, player_b_id=b, event="333", websocket=sa)
    await mgr.connect(room_id, b, player_a_id=a, player_b_id=b, event="333", websocket=sb)
    return sa, sb


# --------------------------------------------------------------------------- #
# connect / activate
# --------------------------------------------------------------------------- #


async def test_both_connect_activates_and_broadcasts_shared_scramble() -> None:
    cb = Callbacks()
    mgr = make_manager(cb)
    room, a, b = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    sa, sb = await _connect_both(mgr, room, a, b)

    assert cb.activate and cb.activate[0][0] == room
    start_a, start_b = sa.last("start"), sb.last("start")
    assert start_a["scramble"] == start_b["scramble"]  # identical shared scramble
    assert start_a["event"] == "333"
    # cleanup so the prep-timeout task doesn't leak past the test
    await mgr.disconnect(room, a)
    await mgr.disconnect(room, b)


async def test_single_connect_stays_waiting_no_start() -> None:
    cb = Callbacks()
    mgr = make_manager(cb)
    room, a, b = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    sa = FakeSocket()
    await mgr.connect(room, a, player_a_id=a, player_b_id=b, event="333", websocket=sa)
    assert not sa.has("start")
    assert not cb.activate
    await mgr.disconnect(room, a)


async def test_lone_creator_waits_then_activates_when_opponent_joins() -> None:
    # player_a connects to a still-`open` room (player_b unknown) — must NOT
    # activate, and its snapshot reports waiting_opponent with no opponent.
    cb = Callbacks()
    mgr = make_manager(cb, prep_timeout_seconds=1)
    room, a, b = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    sa = FakeSocket()
    await mgr.connect(room, a, player_a_id=a, player_b_id=None, event="333", websocket=sa)
    assert not sa.has("start")
    assert not cb.activate

    snap = mgr.snapshot(room, a)
    assert snap is not None
    assert snap["phase"] == "waiting_opponent"
    assert snap["opponent_present"] is False
    assert snap["opponent_phase"] is None
    assert snap["scramble"] is None

    # player_b's WS now arrives carrying the assigned id -> room learns it and
    # activates; the creator (still connected) receives `start` too.
    sb = FakeSocket()
    await mgr.connect(room, b, player_a_id=a, player_b_id=b, event="333", websocket=sb)
    assert cb.activate and cb.activate[0][0] == room
    assert sa.last("start")["scramble"] == sb.last("start")["scramble"]
    await mgr.disconnect(room, a)
    await mgr.disconnect(room, b)


async def test_snapshot_reflects_phase_and_opponent() -> None:
    cb = Callbacks()
    mgr = make_manager(cb)
    room, a, b = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    await _connect_both(mgr, room, a, b)
    snap = mgr.snapshot(room, a)
    assert snap is not None
    assert snap["type"] == "room_state"
    assert snap["phase"] == "preparing"
    assert snap["opponent_present"] is True
    assert snap["scramble"] is not None
    assert mgr.snapshot(room, uuid.uuid4()) is not None  # viewer arg only picks opponent
    assert mgr.snapshot(uuid.uuid4(), a) is None  # unknown room
    await mgr.disconnect(room, a)
    await mgr.disconnect(room, b)


# --------------------------------------------------------------------------- #
# messaging
# --------------------------------------------------------------------------- #


async def test_broadcast_exclude_and_send() -> None:
    cb = Callbacks()
    mgr = make_manager(cb)
    room, a, b = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    sa, sb = await _connect_both(mgr, room, a, b)
    sa.sent.clear()
    sb.sent.clear()

    await mgr.broadcast(room, {"type": "hello"}, exclude=a)
    assert not sa.has("hello")
    assert sb.has("hello")

    await mgr.send(room, a, {"type": "direct"})
    assert sa.has("direct")
    await mgr.disconnect(room, a)
    await mgr.disconnect(room, b)


# --------------------------------------------------------------------------- #
# ready -> countdown
# --------------------------------------------------------------------------- #


async def test_both_ready_starts_countdown_with_future_start() -> None:
    cb = Callbacks()
    mgr = make_manager(cb, countdown_seconds=5)  # long enough to observe "future"
    room, a, b = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    sa, sb = await _connect_both(mgr, room, a, b)

    await mgr.set_status(room, a, "ready")
    assert not sa.has("countdown")  # only one ready yet
    await mgr.set_status(room, b, "ready")

    cd = sa.last("countdown")
    server_start = datetime.fromisoformat(cd["server_start_at"])
    assert server_start > datetime.now(timezone.utc)
    # opponent saw a's status_update
    assert sb.last("status_update")["player"] == "a"
    await mgr.disconnect(room, a)
    await mgr.disconnect(room, b)


# --------------------------------------------------------------------------- #
# finish -> finalize
# --------------------------------------------------------------------------- #


async def test_both_finish_finalizes_with_smaller_time_winner() -> None:
    cb = Callbacks()
    mgr = make_manager(cb)
    room, a, b = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    sa, sb = await _connect_both(mgr, room, a, b)

    await mgr.record_finish(room, a, time_ms=4000, dnf=False, verify_frames_ok=True)
    assert not cb.finalize  # waiting on b
    await mgr.record_finish(room, b, time_ms=7000, dnf=False, verify_frames_ok=True)

    assert len(cb.finalize) == 1
    result = sa.last("result")
    assert result["winner_id"] == str(a)
    # RoomState torn down after finalize (no leak).
    assert mgr.get(room) is None


async def test_duplicate_finish_is_ignored() -> None:
    cb = Callbacks()
    mgr = make_manager(cb)
    room, a, b = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    await _connect_both(mgr, room, a, b)
    await mgr.record_finish(room, a, time_ms=4000, dnf=False, verify_frames_ok=False)
    await mgr.record_finish(room, a, time_ms=1, dnf=False, verify_frames_ok=False)  # ignored
    # still not finalized (b hasn't finished); a's outcome stays the first one
    assert not cb.finalize
    st = mgr.get(room)
    assert st is not None and st.outcomes[a].time_ms == 4000
    await mgr.disconnect(room, a)
    await mgr.disconnect(room, b)


# --------------------------------------------------------------------------- #
# phase timeouts
# --------------------------------------------------------------------------- #


async def test_prep_timeout_forces_dnf_for_not_ready() -> None:
    cb = Callbacks()
    mgr = make_manager(cb, prep_timeout_seconds=0.03)
    room, a, b = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    await _connect_both(mgr, room, a, b)
    # nobody readies -> prep timeout finalizes both dnf -> tie
    await asyncio.sleep(0.08)
    assert len(cb.finalize) == 1
    _room, oa, ob = cb.finalize[0]
    assert oa.status == "dnf" and ob.status == "dnf"
    assert mgr.get(room) is None


async def test_solve_timeout_forces_dnf_for_no_finish() -> None:
    cb = Callbacks()
    mgr = make_manager(
        cb, prep_timeout_seconds=1, countdown_seconds=0.01, solve_timeout_seconds=0.03
    )
    room, a, b = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    await _connect_both(mgr, room, a, b)
    await mgr.set_status(room, a, "ready")
    await mgr.set_status(room, b, "ready")
    # reach solving, neither finishes -> solve timeout -> both dnf
    await asyncio.sleep(0.1)
    assert len(cb.finalize) == 1
    _room, oa, ob = cb.finalize[0]
    assert oa.status == "dnf" and ob.status == "dnf"
    assert mgr.get(room) is None


# --------------------------------------------------------------------------- #
# disconnect / abandon / heartbeat
# --------------------------------------------------------------------------- #


async def test_disconnect_before_solve_abandons_after_grace() -> None:
    cb = Callbacks()
    mgr = make_manager(cb, prep_timeout_seconds=1, disconnect_grace_seconds=0.03)
    room, a, b = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    sa, sb = await _connect_both(mgr, room, a, b)
    await mgr.disconnect(room, a)  # a leaves during prep
    assert sb.has("opponent_left")
    await asyncio.sleep(0.08)  # grace expires without reconnect
    assert cb.abandon == [room]
    assert mgr.get(room) is None


async def test_reconnect_within_grace_cancels_abandon() -> None:
    cb = Callbacks()
    mgr = make_manager(cb, prep_timeout_seconds=1, disconnect_grace_seconds=0.06)
    room, a, b = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    await _connect_both(mgr, room, a, b)
    await mgr.disconnect(room, a)
    # reconnect before grace elapses
    await asyncio.sleep(0.02)
    sa2 = FakeSocket()
    await mgr.connect(room, a, player_a_id=a, player_b_id=b, event="333", websocket=sa2)
    await asyncio.sleep(0.08)
    assert cb.abandon == []  # abandon cancelled
    assert mgr.get(room) is not None
    await mgr.disconnect(room, a)
    await mgr.disconnect(room, b)


async def test_disconnect_during_solve_survivor_wins_without_submitting() -> None:
    cb = Callbacks()
    mgr = make_manager(cb, prep_timeout_seconds=1, countdown_seconds=0.01, solve_timeout_seconds=5)
    room, a, b = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    sa, sb = await _connect_both(mgr, room, a, b)
    await mgr.set_status(room, a, "ready")
    await mgr.set_status(room, b, "ready")
    await asyncio.sleep(0.05)  # reach solving

    await mgr.disconnect(room, a)  # a vanishes mid-solve; b never submits

    assert len(cb.finalize) == 1
    _room, oa, ob = cb.finalize[0]
    assert oa.status == "dnf"  # leaver
    assert ob.status == "pending"  # survivor never submitted
    assert sb.last("result")["winner_id"] == str(b)  # survivor wins
    assert mgr.get(room) is None


async def test_heartbeat_timeout_disconnects_stale_player() -> None:
    cb = Callbacks()
    mgr = make_manager(
        cb,
        prep_timeout_seconds=1,
        heartbeat_interval_seconds=0.01,
        heartbeat_timeout_seconds=0.03,
        disconnect_grace_seconds=1,
    )
    room, a, b = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    sa, sb = await _connect_both(mgr, room, a, b)
    # b keeps pinging (stays alive); a goes silent -> watchdog drops a
    for _ in range(6):
        await mgr.ping(room, b)
        await asyncio.sleep(0.01)
    assert sb.has("opponent_left")
    st = mgr.get(room)
    assert st is not None and a not in st.connections
    await mgr.disconnect(room, b)


# --------------------------------------------------------------------------- #
# idempotent finalize + task cleanup
# --------------------------------------------------------------------------- #


async def test_finalize_is_idempotent_and_cleans_up_tasks() -> None:
    cb = Callbacks()
    mgr = make_manager(cb)
    room, a, b = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    await _connect_both(mgr, room, a, b)
    st = mgr.get(room)
    assert st is not None
    tasks = list(st.tasks.values())

    await mgr.record_finish(room, a, time_ms=3000, dnf=False, verify_frames_ok=False)
    await mgr.record_finish(room, b, time_ms=3000, dnf=False, verify_frames_ok=False)
    assert len(cb.finalize) == 1

    # A late timeout trigger on the same (now-finished) room is a no-op.
    await mgr.record_finish(room, a, time_ms=1, dnf=False, verify_frames_ok=False)
    assert len(cb.finalize) == 1

    # All scheduled tasks were cancelled at cleanup (no leak).
    await asyncio.sleep(0)
    assert all(t.cancelled() or t.done() for t in tasks)
    assert mgr.get(room) is None
