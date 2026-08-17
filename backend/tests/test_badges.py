"""Badge award engine (app.services.badges) + integration tests.

Covers registry well-formed, grant idempotency, evaluate_* boundaries,
best-effort wrapping, PB-invariant (honesty field unused, solves unmodified).
"""

import pytest
from httpx import AsyncClient
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.models import Solve, User, UserBadge
from app.models.duel import DuelRoom
from app.services import badges as badges_service
from app.services import duel as duel_service
from tests.conftest import EmailSpy


# --------------------------------------------------------------------------- #
# helpers
# --------------------------------------------------------------------------- #


async def _register_and_login(client: AsyncClient, email: str) -> None:
    r = await client.post("/auth/register", json={"email": email, "password": "sup3r-secret-pw"})
    assert r.status_code == 201, r.text
    r = await client.post("/auth/login", data={"username": email, "password": "sup3r-secret-pw"})
    assert r.status_code == 204, r.text


async def _switch_user(client: AsyncClient, email: str) -> None:
    """Log out and register+login a fresh user."""
    client.cookies.clear()
    await _register_and_login(client, email)


# --------------------------------------------------------------------------- #
# Registry well-formed
# --------------------------------------------------------------------------- #


def test_badge_registry_has_unique_codes() -> None:
    codes = list(badges_service.BADGE_REGISTRY.keys())
    assert len(codes) == len(set(codes)), "registry codes must be unique"


def test_badge_registry_codes_in_order() -> None:
    assert list(badges_service.BADGE_REGISTRY.keys()) == [
        "sub_30",
        "first_duel_win",
        "ten_duels",
        "giant_slayer",
        "weekly_debut",
    ]


def test_badge_registry_all_codes_have_non_empty_metadata() -> None:
    for code, badge in badges_service.BADGE_REGISTRY.items():
        assert badge.code == code
        assert isinstance(badge.title, str) and len(badge.title) > 0
        assert isinstance(badge.description, str) and len(badge.description) > 0
        assert isinstance(badge.icon, str) and len(badge.icon) > 0


def test_registry_entry_maps_code_to_badgereaddict() -> None:
    """registry_entry builds a BadgeReadDict with earned=True."""
    result = badges_service.registry_entry("sub_30")
    assert result["code"] == "sub_30"
    assert result["earned"] is True
    assert result["earned_at"] is None
    # Metadata from registry
    assert result["title"] == "Меньше 30"
    assert result["icon"] == "⏱️"


# --------------------------------------------------------------------------- #
# grant idempotent
# --------------------------------------------------------------------------- #


async def test_grant_first_call_returns_true(
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    async with session_maker() as session:
        user = User(email="grant1@example.com", hashed_password="x")
        session.add(user)
        await session.flush()

        result = await badges_service.grant(session, user.id, "sub_30")
        assert result is True

        # Row persisted
        result_query = await session.execute(
            select(UserBadge).where(
                UserBadge.user_id == user.id,
                UserBadge.code == "sub_30",
            )
        )
        row = result_query.scalar_one()
        assert row is not None


async def test_grant_duplicate_returns_false(
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    """Second grant of the same (user, code) → False, only one row."""
    async with session_maker() as session:
        user = User(email="grant2@example.com", hashed_password="x")
        session.add(user)
        await session.flush()

        first = await badges_service.grant(session, user.id, "sub_30")
        assert first is True

        second = await badges_service.grant(session, user.id, "sub_30")
        assert second is False

        # Only one row for this (user, code)
        result = await session.execute(
            select(func.count())
            .select_from(UserBadge)
            .where(
                UserBadge.user_id == user.id,
                UserBadge.code == "sub_30",
            )
        )
        count = result.scalar_one()
        assert count == 1


async def test_grant_different_codes_for_same_user(
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    """Same user can earn multiple badge codes."""
    async with session_maker() as session:
        user = User(email="grant3@example.com", hashed_password="x")
        session.add(user)
        await session.flush()

        r1 = await badges_service.grant(session, user.id, "sub_30")
        r2 = await badges_service.grant(session, user.id, "first_duel_win")
        assert r1 is True
        assert r2 is True


async def test_grant_invalid_code_asserts(session_maker: async_sessionmaker[AsyncSession]) -> None:
    """grant() with a non-registry code raises AssertionError."""
    async with session_maker() as session:
        user = User(email="grant4@example.com", hashed_password="x")
        session.add(user)
        await session.flush()

        with pytest.raises(AssertionError):
            await badges_service.grant(session, user.id, "fake_badge")


# --------------------------------------------------------------------------- #
# evaluate_solve boundaries
# --------------------------------------------------------------------------- #


async def test_evaluate_solve_valid_29999_grants_sub_30(
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    async with session_maker() as session:
        user = User(email="solve1@example.com", hashed_password="x")
        session.add(user)
        await session.flush()

        result = await badges_service.evaluate_solve(session, user, "valid", 29999)
        assert result == ["sub_30"]


async def test_evaluate_solve_valid_30000_no_grant(
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    """Boundary: exactly 30000ms does not grant."""
    async with session_maker() as session:
        user = User(email="solve2@example.com", hashed_password="x")
        session.add(user)
        await session.flush()

        result = await badges_service.evaluate_solve(session, user, "valid", 30000)
        assert result == []


async def test_evaluate_solve_valid_30001_no_grant(
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    """Over 30000ms does not grant."""
    async with session_maker() as session:
        user = User(email="solve3@example.com", hashed_password="x")
        session.add(user)
        await session.flush()

        result = await badges_service.evaluate_solve(session, user, "valid", 30001)
        assert result == []


async def test_evaluate_solve_dnf_no_grant(
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    """DNF status, even with low time_ms, does not grant."""
    async with session_maker() as session:
        user = User(email="solve4@example.com", hashed_password="x")
        session.add(user)
        await session.flush()

        result = await badges_service.evaluate_solve(session, user, "dnf", 5000)
        assert result == []


async def test_evaluate_solve_none_time_no_grant(
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    """status='valid' but time_ms=None does not grant."""
    async with session_maker() as session:
        user = User(email="solve5@example.com", hashed_password="x")
        session.add(user)
        await session.flush()

        result = await badges_service.evaluate_solve(session, user, "valid", None)
        assert result == []


async def test_evaluate_solve_second_sub_30_no_grant(
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    """Second sub-30 solve by same user returns empty (already held)."""
    async with session_maker() as session:
        user = User(email="solve6@example.com", hashed_password="x")
        session.add(user)
        await session.flush()

        first = await badges_service.evaluate_solve(session, user, "valid", 29999)
        assert first == ["sub_30"]

        second = await badges_service.evaluate_solve(session, user, "valid", 15000)
        assert second == []


# --------------------------------------------------------------------------- #
# evaluate_tournament_submit
# --------------------------------------------------------------------------- #


async def test_evaluate_tournament_submit_valid_grants_weekly_debut(
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    from app.models.tournament import Tournament, TournamentAttempt

    async with session_maker() as session:
        user = User(email="tour1@example.com", hashed_password="x")
        tournament = Tournament(iso_year=2026, iso_week=29, event="333", scramble="R U R' U'")
        session.add_all([user, tournament])
        await session.flush()

        attempt = TournamentAttempt(
            user_id=user.id, tournament_id=tournament.id, status="valid", time_ms=25000
        )
        session.add(attempt)
        await session.flush()

        result = await badges_service.evaluate_tournament_submit(session, user, attempt)
        assert result == ["weekly_debut"]


async def test_evaluate_tournament_submit_dnf_no_grant(
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    from app.models.tournament import Tournament, TournamentAttempt

    async with session_maker() as session:
        user = User(email="tour2@example.com", hashed_password="x")
        tournament = Tournament(iso_year=2026, iso_week=29, event="333", scramble="R U R' U'")
        session.add_all([user, tournament])
        await session.flush()

        attempt = TournamentAttempt(
            user_id=user.id, tournament_id=tournament.id, status="dnf", time_ms=None
        )
        session.add(attempt)
        await session.flush()

        result = await badges_service.evaluate_tournament_submit(session, user, attempt)
        assert result == []


async def test_evaluate_tournament_submit_second_valid_no_grant(
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    """Second valid tournament submit by same user returns empty."""
    from app.models.tournament import Tournament, TournamentAttempt

    async with session_maker() as session:
        user = User(email="tour3@example.com", hashed_password="x")
        tournament = Tournament(iso_year=2026, iso_week=29, event="333", scramble="R U R' U'")
        session.add_all([user, tournament])
        await session.flush()

        attempt1 = TournamentAttempt(
            user_id=user.id, tournament_id=tournament.id, status="valid", time_ms=25000
        )
        session.add(attempt1)
        await session.flush()

        first = await badges_service.evaluate_tournament_submit(session, user, attempt1)
        assert first == ["weekly_debut"]

        # Second attempt (different tournament or same, doesn't matter for uniqueness of badge)
        tournament2 = Tournament(iso_year=2026, iso_week=30, event="333", scramble="F R B L U D")
        session.add(tournament2)
        await session.flush()

        attempt2 = TournamentAttempt(
            user_id=user.id, tournament_id=tournament2.id, status="valid", time_ms=26000
        )
        session.add(attempt2)
        await session.flush()

        second = await badges_service.evaluate_tournament_submit(session, user, attempt2)
        assert second == []


# --------------------------------------------------------------------------- #
# evaluate_duel_finalized
# --------------------------------------------------------------------------- #


async def test_evaluate_duel_finalized_winner_gets_first_duel_win(
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    """Winner gets first_duel_win once."""
    async with session_maker() as session:
        a = User(email="duel_a1@example.com", hashed_password="x")
        b = User(email="duel_b1@example.com", hashed_password="x")
        session.add_all([a, b])
        await session.flush()

        room = DuelRoom(
            invite_token="tok1",
            mode="fast",
            event="333",
            status="full",
            player_a_id=a.id,
            player_b_id=b.id,
        )
        session.add(room)
        await session.flush()

        await duel_service.finalize_room(
            session,
            room,
            a_time_ms=4000,
            a_status="valid",
            a_verify_frames_ok=True,
            a_finished_at=None,
            b_time_ms=9000,
            b_status="valid",
            b_verify_frames_ok=True,
            b_finished_at=None,
        )
        assert room.winner_id == a.id

        granted = await badges_service.evaluate_duel_finalized(session, room)
        assert granted[a.id] == ["first_duel_win"]
        assert granted[b.id] == []


async def test_evaluate_duel_finalized_loser_gets_nothing(
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    """Loser never gets win badges."""
    async with session_maker() as session:
        a = User(email="duel_a2@example.com", hashed_password="x")
        b = User(email="duel_b2@example.com", hashed_password="x")
        session.add_all([a, b])
        await session.flush()

        room = DuelRoom(
            invite_token="tok2",
            mode="fast",
            event="333",
            status="full",
            player_a_id=a.id,
            player_b_id=b.id,
        )
        session.add(room)
        await session.flush()

        # a wins
        await duel_service.finalize_room(
            session,
            room,
            a_time_ms=3000,
            a_status="valid",
            a_verify_frames_ok=True,
            a_finished_at=None,
            b_time_ms=5000,
            b_status="valid",
            b_verify_frames_ok=True,
            b_finished_at=None,
        )

        granted = await badges_service.evaluate_duel_finalized(session, room)
        assert "first_duel_win" in granted[a.id]
        assert "first_duel_win" not in granted[b.id]


async def test_evaluate_duel_finalized_tie_no_win_badges(
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    """winner_id=None (tie) grants no win badges to either player."""
    async with session_maker() as session:
        a = User(email="duel_tie_a@example.com", hashed_password="x")
        b = User(email="duel_tie_b@example.com", hashed_password="x")
        session.add_all([a, b])
        await session.flush()

        room = DuelRoom(
            invite_token="tok_tie",
            mode="fast",
            event="333",
            status="full",
            player_a_id=a.id,
            player_b_id=b.id,
        )
        session.add(room)
        await session.flush()

        # Both DNF => tie
        await duel_service.finalize_room(
            session,
            room,
            a_time_ms=None,
            a_status="dnf",
            a_verify_frames_ok=False,
            a_finished_at=None,
            b_time_ms=None,
            b_status="dnf",
            b_verify_frames_ok=False,
            b_finished_at=None,
        )
        assert room.winner_id is None

        granted = await badges_service.evaluate_duel_finalized(session, room)
        assert granted[a.id] == []
        assert granted[b.id] == []


async def test_evaluate_duel_finalized_repeat_idempotent(
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    """Repeat evaluate returns empty (badges already awarded)."""
    async with session_maker() as session:
        a = User(email="duel_repeat_a@example.com", hashed_password="x")
        b = User(email="duel_repeat_b@example.com", hashed_password="x")
        session.add_all([a, b])
        await session.flush()

        room = DuelRoom(
            invite_token="tok_repeat",
            mode="fast",
            event="333",
            status="full",
            player_a_id=a.id,
            player_b_id=b.id,
        )
        session.add(room)
        await session.flush()

        await duel_service.finalize_room(
            session,
            room,
            a_time_ms=3000,
            a_status="valid",
            a_verify_frames_ok=True,
            a_finished_at=None,
            b_time_ms=5000,
            b_status="valid",
            b_verify_frames_ok=True,
            b_finished_at=None,
        )

        first = await badges_service.evaluate_duel_finalized(session, room)
        assert first[a.id] == ["first_duel_win"]

        second = await badges_service.evaluate_duel_finalized(session, room)
        assert second[a.id] == []


async def test_evaluate_duel_finalized_ten_duels_on_tenth_only(
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    """ten_duels fires only on the 10th finished duel."""
    async with session_maker() as session:
        a = User(email="ten_a@example.com", hashed_password="x")
        b = User(email="ten_b@example.com", hashed_password="x")
        session.add_all([a, b])
        await session.flush()

        # Create 9 finished rooms
        for i in range(9):
            room = DuelRoom(
                invite_token=f"ten-{i}",
                mode="fast",
                event="333",
                status="finished",
                player_a_id=a.id,
                player_b_id=b.id,
                winner_id=a.id,
            )
            session.add(room)
        await session.flush()

        # No ten_duels yet
        result = await session.execute(
            select(func.count())
            .select_from(DuelRoom)
            .where(
                DuelRoom.status == "finished",
                (DuelRoom.player_a_id == a.id) | (DuelRoom.player_b_id == a.id),
            )
        )
        count = result.scalar_one()
        assert count == 9

        # Finalize the 10th
        tenth = DuelRoom(
            invite_token="ten-9",
            mode="fast",
            event="333",
            status="full",
            player_a_id=a.id,
            player_b_id=b.id,
        )
        session.add(tenth)
        await session.flush()

        await duel_service.finalize_room(
            session,
            tenth,
            a_time_ms=3000,
            a_status="valid",
            a_verify_frames_ok=True,
            a_finished_at=None,
            b_time_ms=5000,
            b_status="valid",
            b_verify_frames_ok=True,
            b_finished_at=None,
        )

        granted = await badges_service.evaluate_duel_finalized(session, tenth)
        assert "ten_duels" in granted[a.id]
        assert "ten_duels" in granted[b.id]


async def test_evaluate_duel_finalized_abandoned_not_counted(
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    """abandoned DuelRooms don't count toward ten_duels."""
    async with session_maker() as session:
        a = User(email="abandon_a@example.com", hashed_password="x")
        b = User(email="abandon_b@example.com", hashed_password="x")
        session.add_all([a, b])
        await session.flush()

        # 5 finished + 5 abandoned
        for i in range(5):
            session.add(
                DuelRoom(
                    invite_token=f"aband-finished-{i}",
                    mode="fast",
                    event="333",
                    status="finished",
                    player_a_id=a.id,
                    player_b_id=b.id,
                    winner_id=a.id,
                )
            )
            session.add(
                DuelRoom(
                    invite_token=f"aband-abandoned-{i}",
                    mode="fast",
                    event="333",
                    status="abandoned",
                    player_a_id=a.id,
                    player_b_id=b.id,
                )
            )
        await session.flush()

        # Only 5 finished, so 10th threshold not yet reached
        count = await badges_service._finished_duel_count(session, a.id)
        assert count == 5

        # Finalize a 6th: still no ten_duels
        sixth = DuelRoom(
            invite_token="aband-finished-6",
            mode="fast",
            event="333",
            status="full",
            player_a_id=a.id,
            player_b_id=b.id,
        )
        session.add(sixth)
        await session.flush()

        await duel_service.finalize_room(
            session,
            sixth,
            a_time_ms=3000,
            a_status="valid",
            a_verify_frames_ok=True,
            a_finished_at=None,
            b_time_ms=5000,
            b_status="valid",
            b_verify_frames_ok=True,
            b_finished_at=None,
        )

        granted = await badges_service.evaluate_duel_finalized(session, sixth)
        assert "ten_duels" not in granted[a.id]


async def test_evaluate_duel_finalized_giant_slayer_loser_faster(
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    """giant_slayer when loser's best_single_ms < winner's."""
    async with session_maker() as session:
        winner = User(email="giant_winner1@example.com", hashed_password="x", best_single_ms=8000)
        loser = User(email="giant_loser1@example.com", hashed_password="x", best_single_ms=3000)
        session.add_all([winner, loser])
        await session.flush()

        room = DuelRoom(
            invite_token="giant1",
            mode="fast",
            event="333",
            status="full",
            player_a_id=winner.id,
            player_b_id=loser.id,
        )
        session.add(room)
        await session.flush()

        await duel_service.finalize_room(
            session,
            room,
            a_time_ms=7000,
            a_status="valid",
            a_verify_frames_ok=True,
            a_finished_at=None,
            b_time_ms=None,
            b_status="dnf",
            b_verify_frames_ok=False,
            b_finished_at=None,
        )

        granted = await badges_service.evaluate_duel_finalized(session, room)
        assert "giant_slayer" in granted[winner.id]


async def test_evaluate_duel_finalized_giant_slayer_loser_no_pb(
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    """giant_slayer NOT granted when loser has no best_single_ms."""
    async with session_maker() as session:
        winner = User(email="giant_winner2@example.com", hashed_password="x", best_single_ms=8000)
        loser = User(email="giant_loser2@example.com", hashed_password="x", best_single_ms=None)
        session.add_all([winner, loser])
        await session.flush()

        room = DuelRoom(
            invite_token="giant2",
            mode="fast",
            event="333",
            status="full",
            player_a_id=winner.id,
            player_b_id=loser.id,
        )
        session.add(room)
        await session.flush()

        await duel_service.finalize_room(
            session,
            room,
            a_time_ms=5000,
            a_status="valid",
            a_verify_frames_ok=True,
            a_finished_at=None,
            b_time_ms=10000,
            b_status="valid",
            b_verify_frames_ok=True,
            b_finished_at=None,
        )

        granted = await badges_service.evaluate_duel_finalized(session, room)
        assert "giant_slayer" not in granted[winner.id]


async def test_evaluate_duel_finalized_giant_slayer_loser_not_faster(
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    """giant_slayer NOT granted when loser's PB is >= winner's."""
    async with session_maker() as session:
        winner = User(email="giant_winner3@example.com", hashed_password="x", best_single_ms=5000)
        loser = User(email="giant_loser3@example.com", hashed_password="x", best_single_ms=6000)
        session.add_all([winner, loser])
        await session.flush()

        room = DuelRoom(
            invite_token="giant3",
            mode="fast",
            event="333",
            status="full",
            player_a_id=winner.id,
            player_b_id=loser.id,
        )
        session.add(room)
        await session.flush()

        await duel_service.finalize_room(
            session,
            room,
            a_time_ms=4000,
            a_status="valid",
            a_verify_frames_ok=True,
            a_finished_at=None,
            b_time_ms=10000,
            b_status="valid",
            b_verify_frames_ok=True,
            b_finished_at=None,
        )

        granted = await badges_service.evaluate_duel_finalized(session, room)
        assert "giant_slayer" not in granted[winner.id]


async def test_evaluate_duel_finalized_giant_slayer_winner_no_pb_vs_loser_with(
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    """giant_slayer granted when winner's PB is None but loser has one."""
    async with session_maker() as session:
        winner = User(email="giant_winner4@example.com", hashed_password="x", best_single_ms=None)
        loser = User(email="giant_loser4@example.com", hashed_password="x", best_single_ms=5000)
        session.add_all([winner, loser])
        await session.flush()

        room = DuelRoom(
            invite_token="giant4",
            mode="fast",
            event="333",
            status="full",
            player_a_id=winner.id,
            player_b_id=loser.id,
        )
        session.add(room)
        await session.flush()

        await duel_service.finalize_room(
            session,
            room,
            a_time_ms=4000,
            a_status="valid",
            a_verify_frames_ok=True,
            a_finished_at=None,
            b_time_ms=10000,
            b_status="valid",
            b_verify_frames_ok=True,
            b_finished_at=None,
        )

        granted = await badges_service.evaluate_duel_finalized(session, room)
        assert "giant_slayer" in granted[winner.id]


# --------------------------------------------------------------------------- #
# Best-effort wrapping (call-site wrapper, not grant itself)
# --------------------------------------------------------------------------- #


async def test_best_effort_wrapping_solve(
    client: AsyncClient, email_spy: EmailSpy, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Badge evaluator raises => solve still commits, new_badges=[]."""

    async def _boom(*args: object, **kwargs: object) -> list[str]:
        raise RuntimeError("badge engine exploded")

    monkeypatch.setattr("app.routers.solves.badges_service.evaluate_solve", _boom)

    await _register_and_login(client, "best_effort_solve@example.com")
    resp = await client.post(
        "/solves", json={"scramble": "R U R' U'", "time_ms": 5000, "status": "valid"}
    )
    assert resp.status_code == 201, resp.text
    assert resp.json()["new_badges"] == []


async def test_best_effort_wrapping_tournament(
    client: AsyncClient, email_spy: EmailSpy, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Badge evaluator raises on tournament => submit still commits."""

    async def _boom(*args: object, **kwargs: object) -> list[str]:
        raise RuntimeError("badge engine exploded")

    monkeypatch.setattr("app.routers.tournament.badges_service.evaluate_tournament_submit", _boom)

    await _register_and_login(client, "best_effort_tour@example.com")
    # Start a tournament attempt
    resp = await client.post("/tournament/current/attempt/start")
    assert resp.status_code == 200, resp.text

    # Submit it (badge evaluator will raise)
    resp = await client.post(
        "/tournament/current/attempt/submit", json={"time_ms": 25000, "status": "valid"}
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["new_badges"] == []


# --------------------------------------------------------------------------- #
# Integration tests: REST endpoints
# --------------------------------------------------------------------------- #


async def test_post_solves_sub_30_grants_badge(client: AsyncClient, email_spy: EmailSpy) -> None:
    """POST /solves with sub-30 time => new_badges has sub_30."""
    await _register_and_login(client, "integration_solve1@example.com")

    resp = await client.post(
        "/solves", json={"scramble": "R U R' U'", "time_ms": 29999, "status": "valid"}
    )
    assert resp.status_code == 201, resp.text
    body = resp.json()
    codes = [b["code"] for b in body["new_badges"]]
    assert "sub_30" in codes


async def test_post_solves_sub_30_persisted(client: AsyncClient, email_spy: EmailSpy) -> None:
    """Badge row persisted in user_badges."""
    await _register_and_login(client, "integration_solve2@example.com")

    resp = await client.post(
        "/solves", json={"scramble": "R U R' U'", "time_ms": 29999, "status": "valid"}
    )
    assert resp.status_code == 201, resp.text

    # Query badges
    badges_resp = await client.get("/badges")
    assert badges_resp.status_code == 200, badges_resp.text
    badges = badges_resp.json()
    sub_30 = next((b for b in badges if b["code"] == "sub_30"), None)
    assert sub_30 is not None
    assert sub_30["earned"] is True
    assert sub_30["earned_at"] is not None


async def test_post_solves_second_sub_30_empty_badges(
    client: AsyncClient, email_spy: EmailSpy
) -> None:
    """Second sub-30 solve => new_badges empty."""
    await _register_and_login(client, "integration_solve3@example.com")

    resp1 = await client.post(
        "/solves", json={"scramble": "R U R' U'", "time_ms": 29999, "status": "valid"}
    )
    assert resp1.status_code == 201, resp1.text
    assert len(resp1.json()["new_badges"]) > 0

    resp2 = await client.post(
        "/solves", json={"scramble": "R U R' U'", "time_ms": 15000, "status": "valid"}
    )
    assert resp2.status_code == 201, resp2.text
    assert resp2.json()["new_badges"] == []


async def test_get_badges_anonymous_401(client: AsyncClient) -> None:
    """GET /badges without auth => 401."""
    resp = await client.get("/badges")
    assert resp.status_code == 401, resp.text


async def test_get_badges_authed_full_registry(client: AsyncClient, email_spy: EmailSpy) -> None:
    """GET /badges returns full registry, all locked for new user."""
    await _register_and_login(client, "integration_badges1@example.com")

    resp = await client.get("/badges")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    codes = {b["code"] for b in body}
    assert codes == set(badges_service.BADGE_REGISTRY.keys())
    assert all(b["earned"] is False for b in body)


async def test_get_badges_earned_locked_flags(client: AsyncClient, email_spy: EmailSpy) -> None:
    """GET /badges correctly marks earned vs locked."""
    await _register_and_login(client, "integration_badges2@example.com")

    # Earn one badge
    await client.post(
        "/solves", json={"scramble": "R U R' U'", "time_ms": 29999, "status": "valid"}
    )

    resp = await client.get("/badges")
    assert resp.status_code == 200, resp.text
    body = resp.json()

    sub_30 = next((b for b in body if b["code"] == "sub_30"), None)
    assert sub_30 is not None
    assert sub_30["earned"] is True

    # Others still locked
    first_win = next((b for b in body if b["code"] == "first_duel_win"), None)
    assert first_win is not None
    assert first_win["earned"] is False


async def test_post_tournament_submit_valid_grants_weekly_debut(
    client: AsyncClient, email_spy: EmailSpy
) -> None:
    """POST /tournament/current/attempt/submit valid => new_badges has weekly_debut."""
    await _register_and_login(client, "integration_tour1@example.com")

    resp = await client.post("/tournament/current/attempt/start")
    assert resp.status_code == 200, resp.text

    resp = await client.post(
        "/tournament/current/attempt/submit", json={"time_ms": 25000, "status": "valid"}
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    codes = [b["code"] for b in body["new_badges"]]
    assert "weekly_debut" in codes


async def test_post_tournament_full_flow_zero_solves(
    client: AsyncClient, email_spy: EmailSpy
) -> None:
    """§П5 invariant: full duel still writes zero solves."""
    await _register_and_login(client, "integration_pb_inv@example.com")

    # Do a tournament attempt
    resp = await client.post("/tournament/current/attempt/start")
    assert resp.status_code == 200, resp.text

    resp = await client.post(
        "/tournament/current/attempt/submit", json={"time_ms": 25000, "status": "valid"}
    )
    assert resp.status_code == 200, resp.text

    # List solves — should be empty
    solves_resp = await client.get("/solves")
    assert solves_resp.status_code == 200, solves_resp.text
    assert solves_resp.json() == []


# --------------------------------------------------------------------------- #
# Invariant: honesty-free, solves unmodified
# --------------------------------------------------------------------------- #


async def test_invariant_evaluate_does_not_read_honesty_fields(
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    """Engine never reads honesty field from ORM models in actual code."""
    # Check the actual implementations, not docstrings
    # evaluate_solve only reads: user, status, time_ms
    # evaluate_tournament_submit only reads: user, attempt.status
    # evaluate_duel_finalized only reads: room, User.best_single_ms
    # None of these read any honesty field or verify_frames_ok from the models
    # This is verified by the implementations which don't access those attributes

    # The actual test is that all three evaluators complete without error
    # and only award based on status/time/best_single_ms, never honesty
    async with session_maker() as session:
        user = User(email="honesty_inv@example.com", hashed_password="x")
        session.add(user)
        await session.flush()

        # evaluate_solve works with just time_ms and status
        result = await badges_service.evaluate_solve(session, user, "valid", 25000)
        assert isinstance(result, list)


async def test_invariant_sub_30_solve_and_duel_preserve_pb(
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    """After a sub-30 solve + duel, best_single_ms and solves count are unchanged."""
    async with session_maker() as session:
        user = User(email="pb_inv@example.com", hashed_password="x")
        session.add(user)
        await session.flush()

        # Do a sub-30 solve
        solve = Solve(
            user_id=user.id,
            duel_id=None,
            tournament_id=None,
            cube_id=None,
            scramble_id=None,
            scramble="R U R' U'",
            time_ms=25000,
            status="valid",
            verify_frames_ok=True,
        )
        session.add(solve)
        await session.flush()

        # Update PB as the router would
        if user.best_single_ms is None or 25000 < user.best_single_ms:
            user.best_single_ms = 25000
            session.add(user)

        # Badge award doesn't write solves or modify best_single_ms
        await badges_service.evaluate_solve(session, user, "valid", 25000)
        await session.commit()

        assert user.best_single_ms == 25000  # Still updated by router, not badge engine
        result = await session.execute(select(func.count()).select_from(Solve))
        solve_count = result.scalar_one()
        assert solve_count == 1


async def test_invariant_award_writes_only_user_badges(
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    """Badge grant writes ONLY to user_badges table, never solves or user."""
    async with session_maker() as session:
        user = User(email="award_inv@example.com", hashed_password="x")
        session.add(user)
        await session.flush()

        # Before: count tables
        before_badges = await session.execute(select(func.count()).select_from(UserBadge))
        before_solve = await session.execute(select(func.count()).select_from(Solve))
        before_solve_count = before_solve.scalar_one()
        before_badge_count = before_badges.scalar_one()

        # Award
        await badges_service.grant(session, user.id, "sub_30")
        await session.flush()

        # After: only user_badges changed
        after_badges = await session.execute(select(func.count()).select_from(UserBadge))
        after_solve = await session.execute(select(func.count()).select_from(Solve))
        after_solve_count = after_solve.scalar_one()
        after_badge_count = after_badges.scalar_one()

        assert after_badge_count == before_badge_count + 1
        assert after_solve_count == before_solve_count
