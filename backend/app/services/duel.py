"""Duel-room DB layer: create/join/rematch/finalize/abandon a link-invite
duel room, idempotently under races. Follows `app.services.tournament`'s
get-or-create + `session.begin_nested()` SAVEPOINT pattern.

Plumbing only (this brick): `time_ms` is self-reported, `verify_frames_ok`
is stored raw and never read as a verdict, and every duel's `a_honesty`/
`b_honesty` stay "pending" forever — `compute_winner` below NEVER reads
honesty at all. `solves` is NEVER written by this brick (§П5 PB-invariant
frozen) — a full duel result lives entirely on the `DuelRoom` row.

П11 ("one active duel per user") is enforced by `DuelParticipant`'s partial
UNIQUE(user_id) WHERE active — see that model's docstring for why a
two-column check on `DuelRoom` alone can't be raced safely with
`begin_nested()`. Every path that inserts a participant here follows the
SAME shape as `tournament.get_or_create_current_tournament`: attempt the
insert inside a nested transaction, and on `IntegrityError` (lost the race)
re-SELECT the winning row instead of raising raw.
"""

import secrets
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any, cast

from sqlalchemy import and_, case, func, or_, select, update
from sqlalchemy.engine import CursorResult
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.models.duel import DuelRoom
from app.models.duel_participant import DuelParticipant

EVENT = "333"
MODE = "fast"

# Rank hierarchy for `compute_winner`: valid beats a still-pending
# (never-submitted) result, which in turn beats a `dnf`. See that function's
# docstring for why "pending > dnf" is deliberate (disconnect-DNF rule).
_STATUS_RANK: dict[str, int] = {"dnf": 0, "pending": 1, "valid": 2}


def now_utc() -> datetime:
    """Centralized clock. Tests monkeypatch this or pass an explicit `now`."""
    return datetime.now(timezone.utc)


class DuelNotFoundError(Exception):
    """No room for that id/invite token (or, for `rematch`, an unknown/foreign parent)."""


class DuelRoomFullError(Exception):
    """`join_room` lost the `player_b` slot to someone else (or it was already taken)."""


class DuelConflictError(Exception):
    """П11: the caller already has another active duel — `existing_room_id` names it."""

    def __init__(self, existing_room_id: uuid.UUID) -> None:
        self.existing_room_id = existing_room_id
        super().__init__("User already has an active duel")


def _room_is_stale(room: DuelRoom, now: datetime, invite_ttl: int, stale_after: int) -> bool:
    """Комната, в которую уже нельзя вернуться, но участник в ней всё ещё активен.

    Два случая, и оба наблюдаемы:

    * **`open` дольше жизни приглашения.** Человек создал комнату, ссылку никто
      не открыл. Приглашение протухло (`_invite_expired`), войти по нему
      невозможно — а участник остался активным навсегда.
    * **Любая незавершённая комната старше `stale_after`.** Состояние идущей
      дуэли живёт в памяти процесса (см. `duel_manager`), и рестарт API его
      теряет. Строка в базе при этом остаётся `active`, таймеры её больше
      никогда не тронут, и комната зависает мёртвой.

    Терминальные (`finished`/`abandoned`) сюда не попадают: там участники
    деактивируются штатно, и статус — результат, а не подвешенное состояние.
    """
    if room.status in ("finished", "abandoned"):
        return False
    if room.status == "open" and _invite_expired(room, now, invite_ttl):
        return True
    return _as_utc(now) > _as_utc(room.created_at) + timedelta(seconds=stale_after)


async def find_active_room(
    session: AsyncSession,
    user_id: uuid.UUID,
    *,
    now: datetime | None = None,
    invite_ttl_seconds: int | None = None,
    stale_after_seconds: int | None = None,
) -> DuelRoom | None:
    """Текущая активная комната участника — если в неё ещё можно вернуться.

    Backs the П11 conflict response AND the reconnect-if-you-already-have-one
    lookup. At most one row can ever match (the partial-UNIQUE index on
    `DuelParticipant` guarantees it) — `scalar_one_or_none` deliberately does
    NOT swallow a `MultipleResultsFound`, since that would indicate the
    constraint itself is broken, not a normal outcome to paper over.

    ЗАСТРЯВШИЕ КОМНАТЫ ОСВОБОЖДАЮТСЯ ЗДЕСЬ. Раньше функция возвращала строку
    как есть, и человек с протухшей комнатой получал 409 на каждую попытку
    создать новую — навсегда, потому что ручки «удалить комнату» не
    существовало. Партиал-UNIQUE, который защищает от двух дуэлей разом,
    превращался в замок без ключа.

    Освобождение делается ровно здесь, а не отдельной уборкой по расписанию, по
    двум причинам: это единственная точка, через которую проходят и создание, и
    переподключение, и человек чинится в тот момент, когда ему это нужно, а не
    через час.
    """
    result = await session.execute(
        select(DuelRoom)
        .join(DuelParticipant, DuelParticipant.room_id == DuelRoom.id)
        .where(DuelParticipant.user_id == user_id, DuelParticipant.active.is_(True))
    )
    room = result.scalar_one_or_none()
    if room is None:
        return None

    settings = get_settings()
    stale = _room_is_stale(
        room,
        now if now is not None else now_utc(),
        invite_ttl_seconds if invite_ttl_seconds is not None else settings.DUEL_INVITE_TTL_SECONDS,
        stale_after_seconds
        if stale_after_seconds is not None
        else settings.DUEL_ROOM_STALE_SECONDS,
    )
    if not stale:
        return room

    # Комната мертва: отпускаем участников и помечаем её брошенной, чтобы она
    # не всплыла ни здесь, ни в истории как «идущая».
    await abandon_room(session, room)
    await session.flush()
    return None


async def create_room(session: AsyncSession, user_id: uuid.UUID) -> DuelRoom:
    """Create a new `open` duel room for `user_id` as `player_a`.

    409s (`DuelConflictError`) if the caller already has an active duel —
    enforced by the `DuelParticipant` partial-UNIQUE race, not a pre-check
    (a pre-check alone would be TOCTOU-racy; see module docstring).

    Вызов `find_active_room` перед вставкой — НЕ вернувшийся pre-check. Гонку
    по-прежнему решает индекс; этот вызов нужен ради побочного действия: он
    отпускает зависшую комнату (см. его докстринг). Без него человек с мёртвой
    комнатой получал бы ошибку на первом нажатии и успех на втором — «нажми ещё
    раз, и заработает» это не поведение, это издевательство.
    """
    await find_active_room(session, user_id)
    try:
        async with session.begin_nested():
            room = DuelRoom(
                invite_token=secrets.token_urlsafe(24),
                mode=MODE,
                event=EVENT,
                status="open",
                player_a_id=user_id,
            )
            session.add(room)
            await session.flush()
            session.add(DuelParticipant(user_id=user_id, room_id=room.id, active=True))
            await session.flush()
    except IntegrityError as exc:
        # Lost the partial-UNIQUE(user_id WHERE active) race — the SAVEPOINT
        # rolled back both the room and participant insert together (same
        # nested transaction). Re-SELECT the winning active room. If none is
        # found, the IntegrityError wasn't actually the П11 race (e.g. an
        # astronomically unlikely invite_token collision) — surface it.
        existing = await find_active_room(session, user_id)
        if existing is None:
            raise
        raise DuelConflictError(existing.id) from exc
    return room


def _as_utc(value: datetime) -> datetime:
    """Normalize to an aware UTC datetime: sqlite hands back naive datetimes
    after flush, Postgres hands back aware ones. Shared by `_invite_expired`
    and `series_chain` — same trap, same fix.
    """
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value


def _invite_expired(room: DuelRoom, now: datetime, ttl_seconds: int) -> bool:
    """Mirrors `tournament.is_past_deadline`'s tz-normalization: sqlite hands
    back naive datetimes after flush, Postgres hands back aware ones.
    """
    return _as_utc(now) > _as_utc(room.created_at) + timedelta(seconds=ttl_seconds)


async def join_room(
    session: AsyncSession,
    invite_token: str,
    user_id: uuid.UUID,
    invite_ttl_seconds: int,
    now: datetime | None = None,
) -> DuelRoom:
    """Second player joins via the invite link.

    Idempotent for an existing participant (reconnect: returns the same room
    regardless of status/age). A brand-new joiner is rejected 404 if the
    token is unknown or the invite has aged past `invite_ttl_seconds`, 409 if
    `player_b` is already taken by someone else (`DuelRoomFullError`) or the
    joiner already has another active duel elsewhere (`DuelConflictError`,
    П11). The final `player_b` claim uses a guarded UPDATE
    (`WHERE player_b_id IS NULL`) to close the narrow race window between the
    initial SELECT and this call and a concurrent third joiner.
    """
    effective_now = now if now is not None else now_utc()
    result = await session.execute(select(DuelRoom).where(DuelRoom.invite_token == invite_token))
    room = result.scalar_one_or_none()
    if room is None:
        raise DuelNotFoundError()

    if user_id in (room.player_a_id, room.player_b_id):
        return room  # idempotent reconnect for an existing participant

    if room.player_b_id is not None:
        raise DuelRoomFullError()

    if _invite_expired(room, effective_now, invite_ttl_seconds):
        raise DuelNotFoundError()

    # Тот же ход, что и в `create_room`: отпустить СВОЮ зависшую комнату до
    # вставки. Иначе человек с мёртвой комнатой не может даже принять чужое
    # приглашение — а это самый частый способ попасть в дуэль.
    await find_active_room(session, user_id, now=effective_now)

    try:
        async with session.begin_nested():
            session.add(DuelParticipant(user_id=user_id, room_id=room.id, active=True))
            await session.flush()
    except IntegrityError as exc:
        existing = await find_active_room(session, user_id)
        if existing is None:
            raise
        raise DuelConflictError(existing.id) from exc

    update_result = cast(
        "CursorResult[Any]",
        await session.execute(
            update(DuelRoom)
            .where(DuelRoom.id == room.id, DuelRoom.player_b_id.is_(None))
            .values(player_b_id=user_id, status="full")
        ),
    )
    if update_result.rowcount == 0:
        # Lost the player_b race to a third joiner between our SELECT above
        # and this UPDATE. Roll back the participant row we just flushed so
        # user_id isn't left with a phantom active duel.
        await session.rollback()
        raise DuelRoomFullError()

    room.player_b_id = user_id
    room.status = "full"
    return room


async def rematch(session: AsyncSession, parent: DuelRoom, user_id: uuid.UUID) -> DuelRoom:
    """Get-or-create the rematch child room for `parent`, keyed on the
    UNIQUE `parent_room_id` column (MED fix): a double-click by BOTH players
    hits this same get-or-create, so exactly ONE child room is ever created —
    whichever request wins the race creates it (both players auto-carried
    over from `parent`, no separate invite/join step needed since they're
    already known), the loser re-SELECTs and returns the SAME row.
    """
    if user_id not in (parent.player_a_id, parent.player_b_id):
        raise DuelNotFoundError()
    if parent.player_b_id is None:
        raise DuelNotFoundError()
    if parent.status != "finished":
        # Real flow only ever offers "Реванш" from a finished room's result
        # screen. A parent that is still open/full/active has BOTH its
        # participants already `active=True`; inserting the child's two
        # `DuelParticipant` rows below would collide with the partial-UNIQUE
        # (user_id WHERE active) index and previously surfaced as a bare
        # IntegrityError -> 500. Reject cleanly (404, same as an unknown
        # room — the router's DuelNotFoundError handler) instead (skeptic
        # HIGH fix, plan: rematch-series) — this also keeps every non-final
        # link in a series chain guaranteed `finished` for
        # `series_chain`/`tally_series`.
        raise DuelNotFoundError()

    result = await session.execute(select(DuelRoom).where(DuelRoom.parent_room_id == parent.id))
    existing = result.scalar_one_or_none()
    if existing is not None:
        return existing

    try:
        async with session.begin_nested():
            child = DuelRoom(
                invite_token=secrets.token_urlsafe(24),
                mode=parent.mode,
                event=parent.event,
                status="full",
                player_a_id=parent.player_a_id,
                player_b_id=parent.player_b_id,
                parent_room_id=parent.id,
            )
            session.add(child)
            await session.flush()
            session.add_all(
                [
                    DuelParticipant(user_id=parent.player_a_id, room_id=child.id, active=True),
                    DuelParticipant(user_id=parent.player_b_id, room_id=child.id, active=True),
                ]
            )
            await session.flush()
    except IntegrityError:
        # Either the (parent_room_id) UNIQUE race (the expected double-click
        # case) or a partial-UNIQUE(user_id WHERE active) П11 race (rarer:
        # one of the two already started an unrelated duel elsewhere in the
        # meantime). Re-SELECT by parent_room_id first — only a genuine П11
        # conflict leaves no such row, in which case there's nothing sane to
        # return.
        result = await session.execute(select(DuelRoom).where(DuelRoom.parent_room_id == parent.id))
        existing = result.scalar_one_or_none()
        if existing is None:
            raise
        return existing
    return child


async def persist_scramble(session: AsyncSession, room: DuelRoom, scramble: str) -> DuelRoom:
    """Reveal the shared scramble and transition to `active`. Caller commits.

    The ONLY place a `DuelRoom.scramble` is ever written — called from the WS
    layer's activation callback once both players are connected (see
    `app.routers.duel`), never from a REST route.
    """
    room.scramble = scramble
    room.status = "active"
    session.add(room)
    return room


async def _deactivate_participants(session: AsyncSession, room_id: uuid.UUID) -> None:
    await session.execute(
        update(DuelParticipant)
        .where(DuelParticipant.room_id == room_id, DuelParticipant.active.is_(True))
        .values(active=False)
    )


async def finalize_room(
    session: AsyncSession,
    room: DuelRoom,
    *,
    a_time_ms: int | None,
    a_status: str,
    a_verify_frames_ok: bool | None,
    a_finished_at: datetime | None,
    b_time_ms: int | None,
    b_status: str,
    b_verify_frames_ok: bool | None,
    b_finished_at: datetime | None,
    now: datetime | None = None,
) -> DuelRoom:
    """Persist the final result and compute the provisional winner.

    Idempotent (mirrors `tournament.sweep_expired_attempts`'s re-guard
    style): a room already `finished` is returned unchanged, a no-op — safe
    to call twice under a duplicate finalize trigger (e.g. both a `finish`
    frame and a concurrently-firing phase-timeout).
    """
    if room.status == "finished":
        return room
    # Invariant: finalize_room only ever fires once both players have joined
    # (the WS route only opens once `player_b_id` is set — see
    # app.routers.duel.duel_ws's 4404 guard) — narrows the type for
    # compute_winner below, which takes a non-nullable player_b_id.
    assert room.player_b_id is not None, "finalize_room requires a fully joined room"
    room.a_time_ms = a_time_ms
    room.a_status = a_status
    room.a_verify_frames_ok = a_verify_frames_ok
    room.a_finished_at = a_finished_at
    room.b_time_ms = b_time_ms
    room.b_status = b_status
    room.b_verify_frames_ok = b_verify_frames_ok
    room.b_finished_at = b_finished_at
    room.winner_id = compute_winner(
        room.player_a_id,
        a_status,
        a_time_ms,
        a_finished_at,
        room.player_b_id,
        b_status,
        b_time_ms,
        b_finished_at,
    )
    room.status = "finished"
    room.finished_at = now if now is not None else now_utc()
    session.add(room)
    await _deactivate_participants(session, room.id)
    return room


async def abandon_room(
    session: AsyncSession, room: DuelRoom, now: datetime | None = None
) -> DuelRoom:
    """Mark a room `abandoned` (disconnect grace expired before both were
    present / ready). Idempotent: a no-op if already `finished`/`abandoned`.
    """
    if room.status in ("finished", "abandoned"):
        return room
    room.status = "abandoned"
    room.finished_at = now if now is not None else now_utc()
    session.add(room)
    await _deactivate_participants(session, room.id)
    return room


def compute_winner(
    player_a_id: uuid.UUID,
    a_status: str,
    a_time_ms: int | None,
    a_finished_at: datetime | None,
    player_b_id: uuid.UUID,
    b_status: str,
    b_time_ms: int | None,
    b_finished_at: datetime | None,
) -> uuid.UUID | None:
    """Pure, honesty-agnostic winner computation. `honesty` is NEVER read here
    — see the module and `DuelRoom` docstrings.

    Rank hierarchy: `valid`(2) > `pending`/no-result(1) > `dnf`(0). The
    middle rank is deliberate: it's what makes the disconnect-DNF rule work
    without a special case. When a player disconnects during the solve phase
    and never returns, the phase-timeout forces THEM to `dnf` while the
    survivor's outcome may still be `pending` (they may not have finished
    either — the match just concluded because the opponent vanished, not
    because the survivor failed). `pending` beating `dnf` means the survivor
    wins in that case even with no submitted time. Two `pending`s (neither
    player ever produced a result) or two `dnf`s both tie (`None`) — same
    rank, no `time_ms` to compare.

    Equal rank at `valid` -> smaller `time_ms` wins; an exactly-equal valid
    time falls back to the first `finished_at` (deterministic, never a coin
    flip). A "valid" status with no `time_ms` recorded (a data-integrity bug,
    should never happen) is treated defensively as a tie rather than raising.
    """
    a_rank = _STATUS_RANK.get(a_status, 1)
    b_rank = _STATUS_RANK.get(b_status, 1)
    if a_rank != b_rank:
        return player_a_id if a_rank > b_rank else player_b_id
    if a_rank != _STATUS_RANK["valid"]:
        return None  # both dnf, or both no-result

    if a_time_ms is None or b_time_ms is None:
        return None  # defensive: "valid" without a time should never happen

    if a_time_ms != b_time_ms:
        return player_a_id if a_time_ms < b_time_ms else player_b_id

    if a_finished_at is not None and b_finished_at is not None and a_finished_at != b_finished_at:
        return player_a_id if a_finished_at < b_finished_at else player_b_id

    return None  # fully identical (pathological) -> tie


@dataclass(frozen=True)
class H2HCounts:
    """Read-only head-to-head aggregate — see `h2h_record`."""

    played: int
    your_wins: int
    opponent_wins: int
    draws: int


async def h2h_record(session: AsyncSession, me_id: uuid.UUID, opponent_id: uuid.UUID) -> H2HCounts:
    """Head-to-head record between `me_id` and `opponent_id`, across every
    `finished` room where they played each other (either slot order; a
    rematch child room counts as its own game, never deduped by
    `parent_room_id`; a room involving any third user is excluded). Read
    only — no `session.add`, no commit.

    `your_wins`/`opponent_wins` are each counted explicitly by `winner_id`
    equality (never derived as `played - the other counts`), and `draws`
    counts `winner_id IS NULL` on its own — a stray `winner_id` matching
    neither player can never be silently folded into a win count.
    """
    pair = and_(
        DuelRoom.status == "finished",
        or_(
            and_(DuelRoom.player_a_id == me_id, DuelRoom.player_b_id == opponent_id),
            and_(DuelRoom.player_a_id == opponent_id, DuelRoom.player_b_id == me_id),
        ),
    )
    result = await session.execute(
        select(
            func.count().label("played"),
            func.sum(case((DuelRoom.winner_id == me_id, 1), else_=0)).label("your_wins"),
            func.sum(case((DuelRoom.winner_id == opponent_id, 1), else_=0)).label("opponent_wins"),
            func.sum(case((DuelRoom.winner_id.is_(None), 1), else_=0)).label("draws"),
        ).where(pair)
    )
    row = result.one()
    return H2HCounts(
        played=int(row.played or 0),
        your_wins=int(row.your_wins or 0),
        opponent_wins=int(row.opponent_wins or 0),
        draws=int(row.draws or 0),
    )


@dataclass(frozen=True)
class SeriesCounts:
    """Read-only running-series aggregate — see `series_record`. Same shape
    as `H2HCounts`; kept as a separate type since the two are NOT
    interchangeable (series is chain-scoped and gap-cut, h2h is lifetime).
    """

    played: int
    your_wins: int
    opponent_wins: int
    draws: int


def series_chain(
    rooms_by_id: dict[uuid.UUID, DuelRoom], room_id: uuid.UUID, gap_seconds: int
) -> list[DuelRoom]:
    """Pure: the current-sitting series chain containing `room_id` — that
    room plus every ancestor reachable by ascending `parent_room_id`,
    oldest first. `rooms_by_id` must already contain every room that could
    possibly be an ancestor (see `series_record`, one SELECT for the whole
    pair) — a parent missing from it is treated the same as "no parent"
    (chain stops there, defensively, rather than raising).

    Descendants (future rematches) are NEVER included (plan D2): the score
    for an old result screen must not change retroactively when a later
    game is played.

    The walk stops — dropping the link to that ancestor and everything
    beyond it — at the first of:
      - a missing parent row,
      - a `parent_room_id` cycle (guarded by a `seen` set; should be
        structurally impossible given the UNIQUE column, but a chain walk
        must never spin forever on bad data),
      - an ancestor whose player pair differs from `room_id`'s (defensive;
        today's `rematch()` always carries the same pair forward),
      - a gap since the ancestor's game ended (`parent.finished_at`,
        falling back to `parent.created_at` for an abandoned parent with no
        `finished_at`) larger than `gap_seconds` — plan D3, "one sitting".
    """
    room = rooms_by_id.get(room_id)
    if room is None:
        return []

    pair = frozenset({room.player_a_id, room.player_b_id})
    chain = [room]
    seen = {room.id}
    node = room
    while node.parent_room_id is not None:
        parent = rooms_by_id.get(node.parent_room_id)
        if parent is None or parent.id in seen:
            break
        if frozenset({parent.player_a_id, parent.player_b_id}) != pair:
            break
        parent_end = parent.finished_at if parent.finished_at is not None else parent.created_at
        if _as_utc(node.created_at) - _as_utc(parent_end) > timedelta(seconds=gap_seconds):
            break
        chain.append(parent)
        seen.add(parent.id)
        node = parent

    chain.reverse()  # oldest -> newest
    return chain


def tally_series(chain: list[DuelRoom], me_id: uuid.UUID, opponent_id: uuid.UUID) -> SeriesCounts:
    """Pure: tally a chain (as returned by `series_chain`) from `me_id`'s
    point of view. Mirrors `h2h_record`'s counting rule exactly (draws are
    `winner_id IS NULL` counted on their own, never `played - wins`), with
    one addition: only `status == "finished"` rooms count toward `played` —
    an `abandoned` link inside the chain does not break the chain (the
    parent->child link still holds through it) but is not a game.
    """
    played = your_wins = opponent_wins = draws = 0
    for room in chain:
        if room.status != "finished":
            continue
        played += 1
        if room.winner_id is None:
            draws += 1
        elif room.winner_id == me_id:
            your_wins += 1
        elif room.winner_id == opponent_id:
            opponent_wins += 1
        # else: winner_id matches neither pair member (defensive) — counted
        # in `played`, folded into no one's win count.
    return SeriesCounts(
        played=played, your_wins=your_wins, opponent_wins=opponent_wins, draws=draws
    )


async def series_record(
    session: AsyncSession, room: DuelRoom, me_id: uuid.UUID, *, gap_seconds: int
) -> SeriesCounts:
    """Current-sitting series score for `room`'s player pair, from `me_id`'s
    point of view — `room` plus its ancestors up to the first `gap_seconds`
    pause (plan: rematch-series, D1: derived, never stored). Read only —
    no `session.add`, no commit.

    ONE SELECT for the whole pair (every room either slot order, any
    status — a chain walk needs abandoned/non-finished ancestors too, just
    not counted toward `played`), not a round trip per chain hop.
    """
    opponent_id = room.player_b_id if me_id == room.player_a_id else room.player_a_id
    assert opponent_id is not None, "series_record requires a fully joined room"

    pair = or_(
        and_(DuelRoom.player_a_id == me_id, DuelRoom.player_b_id == opponent_id),
        and_(DuelRoom.player_a_id == opponent_id, DuelRoom.player_b_id == me_id),
    )
    result = await session.execute(select(DuelRoom).where(pair))
    rooms_by_id = {r.id: r for r in result.scalars().all()}
    rooms_by_id.setdefault(room.id, room)  # defensive: room always in its own chain

    chain = series_chain(rooms_by_id, room.id, gap_seconds)
    return tally_series(chain, me_id, opponent_id)


@dataclass(frozen=True)
class PlayerOutcome:
    """One player's finalized result — the shape `app.services.duel_manager`
    hands to the router's DB-persisting `on_finalize` callback.
    """

    user_id: uuid.UUID
    status: str  # "pending" | "valid" | "dnf"
    time_ms: int | None = None
    verify_frames_ok: bool | None = None
    finished_at: datetime | None = None
