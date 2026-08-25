"""Cups award engine (Brawl-Stars-style ranked ladder, plan: cups-award).

Fired from `app.routers.duel._on_finalize`, AFTER `duel_service.finalize_room(...)`
has set `room.status = "finished"` / `room.winner_id` on the caller's own
session, and BEFORE that session commits — same shape as
`app.services.badges.evaluate_duel_finalized`, which this module is a sibling
to (see that module's docstring for the session-discipline rationale: this
module NEVER opens its own session and NEVER calls `session.commit()`).

ONE PLACE FOR THE NUMBERS (`CUPS_TIERS` below): every rank floor, win gain
and loss amount used by both the award engine and the `/users/me` response
(`app.schemas.user.UserRead.cups_rank/cups_floor/cups_to_next`, via
`tier_bounds`) reads this same table — the frontend never reimplements the
ladder, so it cannot drift from it.

IDEMPOTENCY + RACE SAFETY: `CupsEvent.UNIQUE(room_id, user_id)` is the
guarantee. `_award_one` inserts inside `session.begin_nested()` (a SAVEPOINT)
and treats `IntegrityError` as "already awarded" -> no-op (mirrors
`app.services.badges.grant`'s exact pattern). This gives TWO layers of
protection, deliberately:

  1. Same-transaction: this module is called from the same session that
     just set `room.status = "finished"`, before that session's one commit —
     so a normal call is atomic with the room's finished-transition.
  2. Explicit race guard: `duel_manager._finalize` can, under a genuine
     retry/rematch/disconnect race, invoke the finalize callback for the
     SAME room more than once from DIFFERENT sessions (see
     `duel_service.finalize_room`'s own docstring — it guards re-entry via
     `room.status == "finished"`, but that in-memory check alone can't stop
     two *concurrent* callers who both read the room before either commits).
     The UNIQUE constraint is what actually stops a double-award in that
     window; layer 1 alone would not.

Best-effort at the call site (like badges): `app.routers.duel._on_finalize`
wraps this call in `try/except Exception` so a cups-engine bug can never
abort the underlying match result (mirrors `badges`' exact rationale — see
that module's docstring). Unlike badges, a swallowed cups failure is not
harmless (it's the game's actual economy) — accepted anyway, deliberately,
for consistency with this brick's overriding philosophy that NOTHING
downstream of a duel result may ever corrupt or block that result (see
`duel_service.finalize_room`'s and `duel_manager._finalize`'s own comments on
this). A failure here is a bug to fix and (if it ever happens) backfill by
hand, not a reason to make the whole match unreliable.
"""

import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Literal

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.cups_event import CupsEvent
from app.models.duel import DuelRoom
from app.models.user import User


@dataclass(frozen=True)
class CupsTier:
    name: str
    floor: int
    win_gain: int
    loss_amount: int


# Ranks by cube colour, THE single source of truth for both the award engine
# and `/users/me`'s tier info (`tier_bounds` below). `floor` IS the rank's
# lower bound (owner spec: "порог является ПОЛОМ") — sorted ascending, and
# each tier's upper bound is simply the next tier's `floor - 1` (open-ended
# for the last one).
CUPS_TIERS: tuple[CupsTier, ...] = (
    CupsTier(name="white", floor=0, win_gain=10, loss_amount=0),
    CupsTier(name="yellow", floor=100, win_gain=9, loss_amount=2),
    CupsTier(name="green", floor=300, win_gain=8, loss_amount=4),
    CupsTier(name="blue", floor=600, win_gain=7, loss_amount=6),
    CupsTier(name="orange", floor=1000, win_gain=6, loss_amount=8),
    CupsTier(name="red", floor=1500, win_gain=5, loss_amount=10),
)

# Особые исходы (owner spec), flat regardless of tier:
DRAW_DELTA = 2  # ничья: обоим +2, никто не теряет
WALKOVER_WIN_DELTA = 4  # победа над не явившимся соперником — урезано намеренно
WALKOVER_LOSS_DELTA = 0  # неявившийся ничего не теряет

# Анти-фарм: полное начисление только для первых N дуэлей с ОДНИМ И ТЕМ ЖЕ
# соперником за скользящее окно; дальше — плоские деградированные значения.
# Считается по ЛЮБОМУ исходу (win/loss/draw/walkover) с этим соперником —
# "первые 3 дуэли", а не "первые 3 победы" (см. `_recent_matchup_count`).
FARM_FULL_ALLOWANCE = 3
FARM_WINDOW = timedelta(hours=24)
FARM_DEGRADED_WIN_DELTA = 1
FARM_DEGRADED_LOSS_DELTA = 0

Reason = Literal["win", "loss", "draw", "walkover_win", "walkover_loss"]


def tier_for(cups: int) -> CupsTier:
    """The tier containing `cups` — the highest-floor tier whose `floor <=
    cups`. `CUPS_TIERS[0].floor == 0` and cups are never negative, so this
    always matches at least the white tier.
    """
    current = CUPS_TIERS[0]
    for tier in CUPS_TIERS:
        if tier.floor <= cups:
            current = tier
        else:
            break
    return current


def tier_bounds(cups: int) -> tuple[str, int, int | None]:
    """`(rank_name, floor, cups_to_next_floor)` for `cups` — backs
    `UserRead.cups_rank/cups_floor/cups_to_next` so the frontend never
    reimplements the `CUPS_TIERS` thresholds itself (owner requirement: one
    place for the numbers). `cups_to_next` is `None` at the top (red) tier —
    open-ended, nothing to count down to.
    """
    tiers = CUPS_TIERS
    for i, tier in enumerate(tiers):
        upper_tier = tiers[i + 1] if i + 1 < len(tiers) else None
        if upper_tier is None or cups < upper_tier.floor:
            to_next = None if upper_tier is None else upper_tier.floor - cups
            return tier.name, tier.floor, to_next
    # Unreachable (loop always returns via the open-ended last tier), kept
    # only so mypy sees a total function.
    last = tiers[-1]
    return last.name, last.floor, None


def _clamp(cups_before: int, raw_delta: int) -> int:
    """Apply `raw_delta` to `cups_before`, floored at `cups_before`'s OWN
    tier lower bound — "пол берётся по ступени ДО списания" (owner spec).
    Safe to call for a gain too: `cups_before + raw_delta >= cups_before >=
    floor` always holds for `raw_delta >= 0`, so the floor is a no-op there.
    """
    floor = tier_for(cups_before).floor
    return max(cups_before + raw_delta, floor)


async def _recent_matchup_count(
    session: AsyncSession, user_id: uuid.UUID, opponent_id: uuid.UUID, now: datetime
) -> int:
    """How many cups events `user_id` already has against SPECIFICALLY
    `opponent_id` inside the trailing `FARM_WINDOW` — the anti-farm
    "duel count with this same person today" counter. Symmetric by
    construction (every awarded room writes one event per direction), so
    either player's count agrees; called from the winner's side only.
    """
    result = await session.execute(
        select(func.count())
        .select_from(CupsEvent)
        .where(
            CupsEvent.user_id == user_id,
            CupsEvent.opponent_id == opponent_id,
            CupsEvent.created_at > now - FARM_WINDOW,
        )
    )
    return result.scalar_one()


async def _award_one(
    session: AsyncSession,
    *,
    room_id: uuid.UUID,
    user_id: uuid.UUID,
    opponent_id: uuid.UUID,
    raw_delta: int,
    reason: Reason,
    farm_limited: bool,
    now: datetime,
) -> None:
    """Insert one `CupsEvent` + apply it to `User.cups`, idempotently — see
    module docstring for the `begin_nested()` + `IntegrityError` race guard.

    `created_at` is set EXPLICITLY to `now` (the room's own `finished_at`,
    threaded down from `award_for_finished_room`) rather than left to the
    column's DB `server_default now()`. This matters, not just for test
    determinism: `_recent_matchup_count`'s anti-farm window compares
    `CupsEvent.created_at` against that SAME `now` — if `created_at` were
    the DB's real wall-clock instead, the two clocks would silently
    diverge (e.g. a backdated/replayed finalize, or simply a test driving
    `now` explicitly) and the "same opponent within the last 24h" window
    would compare apples to oranges.
    """
    user = await session.get(User, user_id)
    # FK-enforced: `user_id` is always one of the room's two joined players,
    # who must exist for the room to exist at all.
    assert user is not None, f"cups award target user {user_id} not found"
    cups_before = user.cups
    cups_after = _clamp(cups_before, raw_delta)
    try:
        async with session.begin_nested():
            session.add(
                CupsEvent(
                    room_id=room_id,
                    user_id=user_id,
                    opponent_id=opponent_id,
                    delta=cups_after - cups_before,
                    reason=reason,
                    farm_limited=farm_limited,
                    cups_before=cups_before,
                    cups_after=cups_after,
                    created_at=now,
                )
            )
            await session.flush()
    except IntegrityError:
        # Lost the UNIQUE(room_id, user_id) race — a concurrent finalize
        # call already awarded this exact room+player. Idempotent no-op:
        # do NOT touch `user.cups` again.
        return
    user.cups = cups_after
    session.add(user)


def _classify(
    a_id: uuid.UUID,
    a_status: str,
    b_id: uuid.UUID,
    b_status: str,
    winner_id: uuid.UUID | None,
) -> tuple[uuid.UUID, uuid.UUID, bool] | None:
    """Decide the room's cups outcome from its final statuses, purely.

    Returns `None` for "no award, no event" (owner spec: both sides showed
    no result at all, or the room never reached a real conclusion) — the
    ONLY case that writes nothing. Otherwise `(winner_id, loser_id,
    is_walkover)`; a draw is signalled by `winner_id == loser_id` (both IDs
    the same, see call site) since both players get the identical flat
    `DRAW_DELTA` and there is no winner/loser to distinguish.

    `is_walkover` (owner spec: "победа над не явившимся соперником, у
    соперника результата нет вовсе") is derived from the WINNER's own
    status, not the loser's: reachable via `compute_winner`'s
    pending-beats-dnf rule, a winner ends up `"valid"` in EVERY case where
    the loser ever got a chance to actually record something (`"dnf"` from
    a real attempt or a forced timeout after they'd shown up) — the only way
    the winner's own status is `"pending"` (never produced a result
    themselves either) is the match concluding before they ever got a real
    shot, i.e. the opponent side of the pair is the one who never showed at
    all. See `app.services.duel.compute_winner`'s docstring for the same
    rank mechanics from the other side.
    """
    if winner_id is None:
        # Ничья (обоим +2): либо оба валидны с равным временем, либо ОБА
        # получили dnf (сыграли, но никто не подтвердил сборку — с точки зрения
        # игрока это ничья, и owner ждёт за неё кубки). Оба `pending` — это
        # «никто не явился/не начал», результата нет вовсе → без начисления.
        if (a_status == "valid" and b_status == "valid") or (
            a_status == "dnf" and b_status == "dnf"
        ):
            return (a_id, a_id, False)  # draw: same id both sides, see docstring
        return None  # both pending — no meaningful result, no event
    loser_id = b_id if winner_id == a_id else a_id
    winner_status = a_status if winner_id == a_id else b_status
    is_walkover = winner_status != "valid"
    return (winner_id, loser_id, is_walkover)


async def award_for_finished_room(session: AsyncSession, room: DuelRoom) -> None:
    """Award cups for a just-finalized `room` to both players, idempotently.

    Called AFTER `duel_service.finalize_room(...)` has set
    `room.status/winner_id`, so `room.a_status`/`room.b_status`/
    `room.winner_id`/`room.player_a_id`/`room.player_b_id` are all final.
    `room.finished_at` (already set by `finalize_room`) is the anti-farm
    window's clock — using the room's OWN timestamp rather than a fresh
    "now" keeps a delayed/retried finalize call deterministic.
    """
    if room.status != "finished" or room.player_b_id is None or room.finished_at is None:
        # `status != "finished"` covers `abandoned` explicitly (owner spec:
        # an abandoned room awards nothing) — defensive against a future
        # call site wiring this up outside `_on_finalize`; the other two
        # are guaranteed by `finalize_room` and never hit in practice.
        return
    a_id, b_id = room.player_a_id, room.player_b_id
    outcome = _classify(a_id, room.a_status, b_id, room.b_status, room.winner_id)
    if outcome is None:
        return  # both no-result / abandoned — spec: award nothing, log nothing

    winner_id, loser_id, is_walkover = outcome

    if winner_id == loser_id:  # draw sentinel (see `_classify`)
        # Ничья намеренно НЕ подпадает под анти-фарм деградацию (owner spec
        # перечисляет её отдельно от таблицы победа/поражение) — но каждая
        # ничья по-прежнему пишет событие и потому наравне со всеми учтётся
        # в счётчике будущих дуэлей этой пары за окно.
        await _award_one(
            session,
            room_id=room.id,
            user_id=a_id,
            opponent_id=b_id,
            raw_delta=DRAW_DELTA,
            reason="draw",
            farm_limited=False,
            now=room.finished_at,
        )
        await _award_one(
            session,
            room_id=room.id,
            user_id=b_id,
            opponent_id=a_id,
            raw_delta=DRAW_DELTA,
            reason="draw",
            farm_limited=False,
            now=room.finished_at,
        )
        return

    farm_limited = (
        await _recent_matchup_count(session, winner_id, loser_id, room.finished_at)
        >= FARM_FULL_ALLOWANCE
    )

    if farm_limited:
        win_delta, lose_delta = FARM_DEGRADED_WIN_DELTA, FARM_DEGRADED_LOSS_DELTA
    elif is_walkover:
        win_delta, lose_delta = WALKOVER_WIN_DELTA, WALKOVER_LOSS_DELTA
    else:
        winner = await session.get(User, winner_id)
        loser = await session.get(User, loser_id)
        assert winner is not None and loser is not None, "duel players must exist"
        # "по кубкам ИГРОКА на момент финала" — каждая сторона по СВОЕЙ
        # ступени, не по общей (owner spec).
        win_delta = tier_for(winner.cups).win_gain
        lose_delta = -tier_for(loser.cups).loss_amount

    # `reason` records the KIND regardless of `farm_limited` — a farm-capped
    # walkover win is still, historically, a walkover; `farm_limited` is the
    # separate flag for "and the amount was capped".
    win_reason: Reason = "walkover_win" if is_walkover else "win"
    lose_reason: Reason = "walkover_loss" if is_walkover else "loss"

    await _award_one(
        session,
        room_id=room.id,
        user_id=winner_id,
        opponent_id=loser_id,
        raw_delta=win_delta,
        reason=win_reason,
        farm_limited=farm_limited,
        now=room.finished_at,
    )
    await _award_one(
        session,
        room_id=room.id,
        user_id=loser_id,
        opponent_id=winner_id,
        raw_delta=lose_delta,
        reason=lose_reason,
        farm_limited=farm_limited,
        now=room.finished_at,
    )
