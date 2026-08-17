from datetime import datetime, timedelta, timezone

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.config import get_settings
from app.models import Tournament, TournamentAttempt, User
from app.services import tournament as tournament_service
from tests.conftest import EmailSpy

settings = get_settings()


async def _register(client: AsyncClient, email: str, password: str = "sup3r-secret-pw") -> None:
    resp = await client.post("/auth/register", json={"email": email, "password": password})
    assert resp.status_code == 201, resp.text


async def _login(client: AsyncClient, email: str, password: str = "sup3r-secret-pw") -> None:
    resp = await client.post("/auth/login", data={"username": email, "password": password})
    assert resp.status_code == 204, resp.text


async def _register_and_login(client: AsyncClient, email_spy: EmailSpy, email: str) -> None:
    await _register(client, email)
    await _login(client, email)


# --- auth gate ----------------------------------------------------------------


async def test_start_anonymous_401(client: AsyncClient) -> None:
    resp = await client.post("/tournament/current/attempt/start")
    assert resp.status_code == 401, resp.text


async def test_submit_anonymous_401(client: AsyncClient) -> None:
    resp = await client.post(
        "/tournament/current/attempt/submit", json={"time_ms": 5000, "status": "valid"}
    )
    assert resp.status_code == 401, resp.text


# --- first start ----------------------------------------------------------------


async def test_first_start_creates_tournament_and_attempt(
    client: AsyncClient,
    email_spy: EmailSpy,
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    await _register_and_login(client, email_spy, "first@example.com")
    resp = await client.post("/tournament/current/attempt/start")
    assert resp.status_code == 200, resp.text
    body = resp.json()

    assert body["status"] == "started"
    assert body["honesty"] == "pending"
    assert body["time_ms"] is None
    assert body["submitted_at"] is None
    assert isinstance(body["scramble"], str) and body["scramble"] != ""
    assert body["event"] == "333"

    iso_year, iso_week = tournament_service.current_iso_week()
    assert body["iso_year"] == iso_year
    assert body["iso_week"] == iso_week
    assert body["week_label"] == tournament_service.week_label(iso_year, iso_week)

    async with session_maker() as session:
        tournaments = (await session.execute(select(Tournament))).scalars().all()
        attempts = (await session.execute(select(TournamentAttempt))).scalars().all()
    assert len(tournaments) == 1
    assert len(attempts) == 1
    assert str(tournaments[0].id) == body["tournament_id"]
    assert attempts[0].status == "started"
    assert attempts[0].honesty == "pending"


# --- idempotent start -----------------------------------------------------------


async def test_second_start_same_user_same_week_reloads_same_attempt(
    client: AsyncClient,
    email_spy: EmailSpy,
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    await _register_and_login(client, email_spy, "reload@example.com")
    first = await client.post("/tournament/current/attempt/start")
    second = await client.post("/tournament/current/attempt/start")
    assert first.status_code == 200, first.text
    assert second.status_code == 200, second.text

    assert first.json()["id"] == second.json()["id"]
    assert first.json()["scramble"] == second.json()["scramble"]
    assert first.json()["tournament_id"] == second.json()["tournament_id"]

    async with session_maker() as session:
        tournaments = (await session.execute(select(Tournament))).scalars().all()
        attempts = (await session.execute(select(TournamentAttempt))).scalars().all()
    assert len(tournaments) == 1
    assert len(attempts) == 1


# --- two users share the tournament, get separate attempts ----------------------


async def test_two_users_same_week_share_tournament_but_have_separate_attempts(
    client: AsyncClient,
    email_spy: EmailSpy,
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    await _register_and_login(client, email_spy, "alice@example.com")
    alice = await client.post("/tournament/current/attempt/start")
    assert alice.status_code == 200, alice.text

    await _register_and_login(client, email_spy, "bob@example.com")
    bob = await client.post("/tournament/current/attempt/start")
    assert bob.status_code == 200, bob.text

    assert alice.json()["tournament_id"] == bob.json()["tournament_id"]
    assert alice.json()["scramble"] == bob.json()["scramble"]
    assert alice.json()["id"] != bob.json()["id"]

    async with session_maker() as session:
        tournaments = (await session.execute(select(Tournament))).scalars().all()
        attempts = (await session.execute(select(TournamentAttempt))).scalars().all()
    assert len(tournaments) == 1
    assert len(attempts) == 2


# --- submit -----------------------------------------------------------------


async def test_submit_valid_sets_status_time_and_submitted_at(
    client: AsyncClient, email_spy: EmailSpy
) -> None:
    await _register_and_login(client, email_spy, "valid@example.com")
    await client.post("/tournament/current/attempt/start")

    resp = await client.post(
        "/tournament/current/attempt/submit", json={"time_ms": 12345, "status": "valid"}
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["status"] == "valid"
    assert body["time_ms"] == 12345
    assert body["submitted_at"] is not None
    assert body["honesty"] == "pending"


async def test_submit_dnf(client: AsyncClient, email_spy: EmailSpy) -> None:
    await _register_and_login(client, email_spy, "dnf@example.com")
    await client.post("/tournament/current/attempt/start")

    resp = await client.post(
        "/tournament/current/attempt/submit", json={"time_ms": 5000, "status": "dnf"}
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["status"] == "dnf"
    assert body["time_ms"] == 5000


async def test_submit_without_prior_start_is_404(client: AsyncClient, email_spy: EmailSpy) -> None:
    await _register_and_login(client, email_spy, "nostart@example.com")
    resp = await client.post(
        "/tournament/current/attempt/submit", json={"time_ms": 5000, "status": "valid"}
    )
    assert resp.status_code == 404, resp.text


async def test_submit_twice_is_409(client: AsyncClient, email_spy: EmailSpy) -> None:
    await _register_and_login(client, email_spy, "twice@example.com")
    await client.post("/tournament/current/attempt/start")
    first = await client.post(
        "/tournament/current/attempt/submit", json={"time_ms": 5000, "status": "valid"}
    )
    assert first.status_code == 200, first.text

    second = await client.post(
        "/tournament/current/attempt/submit", json={"time_ms": 6000, "status": "valid"}
    )
    assert second.status_code == 409, second.text


async def test_submit_after_window_forces_dnf(
    client: AsyncClient, email_spy: EmailSpy, monkeypatch: pytest.MonkeyPatch
) -> None:
    await _register_and_login(client, email_spy, "late@example.com")
    start_resp = await client.post("/tournament/current/attempt/start")
    assert start_resp.status_code == 200, start_resp.text

    # Freeze the service clock well past the attempt window, regardless of
    # what the DB's own started_at wall-clock value happens to be.
    future = tournament_service.now_utc() + timedelta(
        seconds=settings.TOURNAMENT_ATTEMPT_WINDOW_SECONDS + 60
    )
    monkeypatch.setattr(tournament_service, "now_utc", lambda: future)

    resp = await client.post(
        "/tournament/current/attempt/submit", json={"time_ms": 5000, "status": "valid"}
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    # Forced dnf regardless of the submitted payload's status/time_ms.
    assert body["status"] == "dnf"
    assert body["time_ms"] is None
    assert body["submitted_at"] is not None


async def test_extra_field_on_submit_is_rejected(client: AsyncClient, email_spy: EmailSpy) -> None:
    await _register_and_login(client, email_spy, "extra@example.com")
    await client.post("/tournament/current/attempt/start")
    resp = await client.post(
        "/tournament/current/attempt/submit",
        json={"time_ms": 5000, "status": "valid", "honesty": "verified"},
    )
    assert resp.status_code == 422, resp.text


# --- GET /tournament/current (read-only, scramble-omitted) -----------------------


async def test_get_current_anonymous_401(client: AsyncClient) -> None:
    resp = await client.get("/tournament/current")
    assert resp.status_code == 401, resp.text


async def test_get_current_no_attempt_returns_null_status_and_creates_no_rows(
    client: AsyncClient,
    email_spy: EmailSpy,
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    await _register_and_login(client, email_spy, "getcurrent-noattempt@example.com")

    resp = await client.get("/tournament/current")
    assert resp.status_code == 200, resp.text
    body = resp.json()

    assert body["attempt_status"] is None
    assert body["time_ms"] is None
    assert body["started_at"] is None
    assert body["submitted_at"] is None
    assert body["deadline_at"] is None
    assert body["event"] == "333"
    assert "scramble" not in body

    iso_year, iso_week = tournament_service.current_iso_week()
    assert body["iso_year"] == iso_year
    assert body["iso_week"] == iso_week
    assert body["week_label"] == tournament_service.week_label(iso_year, iso_week)

    async with session_maker() as session:
        tournaments = (await session.execute(select(Tournament))).scalars().all()
        attempts = (await session.execute(select(TournamentAttempt))).scalars().all()
    assert len(tournaments) == 0
    assert len(attempts) == 0


async def test_get_current_started_attempt_returns_status_and_deadline_no_scramble(
    client: AsyncClient,
    email_spy: EmailSpy,
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    await _register_and_login(client, email_spy, "getcurrent-started@example.com")
    start_resp = await client.post("/tournament/current/attempt/start")
    assert start_resp.status_code == 200, start_resp.text
    started_at = start_resp.json()["started_at"]

    before_tournaments = 1
    before_attempts = 1
    async with session_maker() as session:
        tournaments = (await session.execute(select(Tournament))).scalars().all()
        attempts = (await session.execute(select(TournamentAttempt))).scalars().all()
    assert len(tournaments) == before_tournaments
    assert len(attempts) == before_attempts

    resp = await client.get("/tournament/current")
    assert resp.status_code == 200, resp.text
    body = resp.json()

    assert body["attempt_status"] == "started"
    assert body["time_ms"] is None
    assert body["started_at"] == started_at
    assert body["submitted_at"] is None
    assert body["deadline_at"] is not None
    assert "scramble" not in body

    expected_deadline = datetime.fromisoformat(started_at) + timedelta(
        seconds=settings.TOURNAMENT_ATTEMPT_WINDOW_SECONDS
    )
    assert datetime.fromisoformat(body["deadline_at"]) == expected_deadline

    # GET is read-only: no new rows from the lookup itself.
    async with session_maker() as session:
        tournaments = (await session.execute(select(Tournament))).scalars().all()
        attempts = (await session.execute(select(TournamentAttempt))).scalars().all()
    assert len(tournaments) == before_tournaments
    assert len(attempts) == before_attempts


async def test_get_current_terminal_attempt_returns_status_and_time_no_scramble(
    client: AsyncClient, email_spy: EmailSpy
) -> None:
    await _register_and_login(client, email_spy, "getcurrent-terminal@example.com")
    await client.post("/tournament/current/attempt/start")
    submit_resp = await client.post(
        "/tournament/current/attempt/submit", json={"time_ms": 9999, "status": "valid"}
    )
    assert submit_resp.status_code == 200, submit_resp.text

    resp = await client.get("/tournament/current")
    assert resp.status_code == 200, resp.text
    body = resp.json()

    assert body["attempt_status"] == "valid"
    assert body["time_ms"] == 9999
    assert body["submitted_at"] is not None
    assert "scramble" not in body


# --- service: idempotency + SAVEPOINT recovery -----------------------------------


async def test_get_or_create_current_tournament_is_idempotent(
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    now = datetime(2031, 6, 1, tzinfo=timezone.utc)
    async with session_maker() as session:
        first = await tournament_service.get_or_create_current_tournament(session, now=now)
        await session.commit()
        second = await tournament_service.get_or_create_current_tournament(session, now=now)
        await session.commit()
    assert first.id == second.id


async def test_get_or_create_attempt_is_idempotent(
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    now = datetime(2031, 6, 8, tzinfo=timezone.utc)
    async with session_maker() as session:
        tournament = await tournament_service.get_or_create_current_tournament(session, now=now)
        # A real user row: PRAGMA foreign_keys=ON in the test engine enforces
        # tournament_attempts.user_id -> user.id.
        user = User(email="svc-idempotent@example.com", hashed_password="x")
        session.add(user)
        await session.flush()
        await session.commit()

        user_id = user.id
        first = await tournament_service.get_or_create_attempt(session, user_id, tournament.id)
        await session.commit()
        second = await tournament_service.get_or_create_attempt(session, user_id, tournament.id)
        await session.commit()
    assert first.id == second.id


async def test_duplicate_iso_year_iso_week_insert_raises_integrity_error(
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    async with session_maker() as session:
        session.add(Tournament(iso_year=2033, iso_week=5, scramble="A"))
        await session.commit()

        session.add(Tournament(iso_year=2033, iso_week=5, scramble="B"))
        with pytest.raises(IntegrityError):
            await session.flush()


async def test_begin_nested_isolates_failed_insert_from_sibling(
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    """Prove the begin_nested() SAVEPOINT pattern used by both get_or_create_*
    functions rolls back ONLY a failed insert, never the whole session — the
    HIGH#3 fix distinguishing this from routers/solves.py's whole-session
    nonce rollback.
    """
    async with session_maker() as session:
        survivor = Tournament(iso_year=2040, iso_week=1, scramble="SURVIVOR")
        session.add(survivor)
        await session.flush()

        winner = Tournament(iso_year=2040, iso_week=2, scramble="WINNER")
        session.add(winner)
        await session.flush()

        with pytest.raises(IntegrityError):
            async with session.begin_nested():
                loser = Tournament(iso_year=2040, iso_week=2, scramble="LOSER")
                session.add(loser)
                await session.flush()

        # Only the nested savepoint rolled back; the two prior flushes in this
        # same session/transaction survive and commit cleanly.
        await session.commit()

    async with session_maker() as session:
        rows = (
            (await session.execute(select(Tournament).where(Tournament.iso_year == 2040)))
            .scalars()
            .all()
        )
    assert {(r.iso_week, r.scramble) for r in rows} == {(1, "SURVIVOR"), (2, "WINNER")}


# --- ISO-week edge cases (pure function, no DB) ----------------------------------


def test_iso_week_2026_has_53_weeks() -> None:
    # 2026-12-28 through 2027-01-03 all fall in ISO week 53 of iso_year 2026.
    assert tournament_service.current_iso_week(datetime(2026, 12, 28, tzinfo=timezone.utc)) == (
        2026,
        53,
    )
    assert tournament_service.current_iso_week(datetime(2026, 12, 31, tzinfo=timezone.utc)) == (
        2026,
        53,
    )
    assert tournament_service.current_iso_week(datetime(2027, 1, 1, tzinfo=timezone.utc)) == (
        2026,
        53,
    )
    assert tournament_service.current_iso_week(datetime(2027, 1, 3, tzinfo=timezone.utc)) == (
        2026,
        53,
    )


def test_iso_week_dec31_jan1_crossover_backward() -> None:
    # Calendar date 2021-01-01 belongs to ISO week 53 of the PREVIOUS iso_year.
    assert tournament_service.current_iso_week(datetime(2020, 12, 31, tzinfo=timezone.utc)) == (
        2020,
        53,
    )
    assert tournament_service.current_iso_week(datetime(2021, 1, 1, tzinfo=timezone.utc)) == (
        2020,
        53,
    )


def test_iso_week_dec31_jan1_crossover_forward() -> None:
    # Calendar date 2029-12-31 already belongs to ISO week 1 of the NEXT iso_year.
    assert tournament_service.current_iso_week(datetime(2029, 12, 31, tzinfo=timezone.utc)) == (
        2030,
        1,
    )
    assert tournament_service.current_iso_week(datetime(2030, 1, 1, tzinfo=timezone.utc)) == (
        2030,
        1,
    )


def test_week_label_zero_pads() -> None:
    assert tournament_service.week_label(2020, 53) == "2020-W53"
    assert tournament_service.week_label(2026, 5) == "2026-W05"


def test_now_utc_is_timezone_aware() -> None:
    assert tournament_service.now_utc().tzinfo is not None


# --- standings: anonymous access ----


async def test_standings_anonymous_401(client: AsyncClient) -> None:
    """Standings endpoint requires auth."""
    resp = await client.get("/tournament/current/standings")
    assert resp.status_code == 401, resp.text


# --- standings: empty board ----


async def test_standings_empty_board(client: AsyncClient, email_spy: EmailSpy) -> None:
    """No tournament yet → 200, empty entries, zero counts, your_entry null."""
    await _register_and_login(client, email_spy, "standings-empty@example.com")
    resp = await client.get("/tournament/current/standings")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["entries"] == []
    assert body["your_entry"] is None
    assert body["valid_count"] == 0
    assert body["dnf_count"] == 0
    assert "rank" not in body
    assert "position" not in body


# --- standings: valid attempts ordering ----


async def test_standings_valid_ordered_by_submitted_at(
    client: AsyncClient, email_spy: EmailSpy, session_maker: async_sessionmaker[AsyncSession]
) -> None:
    """Valid attempts ordered by submitted_at ASC, id ASC; is_self only for caller."""
    await _register_and_login(client, email_spy, "alice@example.com")
    alice_start = await client.post("/tournament/current/attempt/start")
    assert alice_start.status_code == 200, alice_start.text

    # Alice submits with time 5000
    alice_submit = await client.post(
        "/tournament/current/attempt/submit", json={"time_ms": 5000, "status": "valid"}
    )
    assert alice_submit.status_code == 200, alice_submit.text

    await _register_and_login(client, email_spy, "bob@example.com")
    bob_start = await client.post("/tournament/current/attempt/start")
    assert bob_start.status_code == 200, bob_start.text

    bob_submit = await client.post(
        "/tournament/current/attempt/submit", json={"time_ms": 3000, "status": "valid"}
    )
    assert bob_submit.status_code == 200, bob_submit.text

    await _register_and_login(client, email_spy, "charlie@example.com")
    charlie_start = await client.post("/tournament/current/attempt/start")
    assert charlie_start.status_code == 200, charlie_start.text

    charlie_submit = await client.post(
        "/tournament/current/attempt/submit", json={"time_ms": 7000, "status": "valid"}
    )
    assert charlie_submit.status_code == 200, charlie_submit.text

    # Charlie is logged in; get standings as Charlie
    resp = await client.get("/tournament/current/standings")
    assert resp.status_code == 200, resp.text
    body = resp.json()

    # All three valid entries, in submitted_at order (alice, bob, charlie)
    assert len(body["entries"]) == 3
    assert body["entries"][0]["time_ms"] == 5000
    assert body["entries"][0]["is_self"] is False
    assert body["entries"][1]["time_ms"] == 3000
    assert body["entries"][1]["is_self"] is False
    assert body["entries"][2]["time_ms"] == 7000
    assert body["entries"][2]["is_self"] is True  # Charlie is the caller
    assert body["valid_count"] == 3
    assert body["dnf_count"] == 0


# --- standings: excludes dnf and started ----


async def test_standings_excludes_dnf_and_started(client: AsyncClient, email_spy: EmailSpy) -> None:
    """DNF appears in dnf_count only; started excluded from both; valid appears."""
    await _register_and_login(client, email_spy, "valid@example.com")
    await client.post("/tournament/current/attempt/start")
    resp = await client.post(
        "/tournament/current/attempt/submit", json={"time_ms": 5000, "status": "valid"}
    )
    assert resp.status_code == 200, resp.text

    await _register_and_login(client, email_spy, "dnf@example.com")
    await client.post("/tournament/current/attempt/start")
    resp = await client.post(
        "/tournament/current/attempt/submit", json={"time_ms": 1, "status": "dnf"}
    )
    assert resp.status_code == 200, resp.text

    await _register_and_login(client, email_spy, "started@example.com")
    await client.post("/tournament/current/attempt/start")
    # No submit; attempt remains "started"

    resp = await client.get("/tournament/current/standings")
    assert resp.status_code == 200, resp.text
    body = resp.json()

    assert len(body["entries"]) == 1  # Only valid
    assert body["entries"][0]["time_ms"] == 5000
    assert body["valid_count"] == 1
    assert body["dnf_count"] == 1


# --- standings: only dnf ----


async def test_standings_only_dnf(client: AsyncClient, email_spy: EmailSpy) -> None:
    """All dnf → entries [], dnf_count N."""
    await _register_and_login(client, email_spy, "dnf1@example.com")
    await client.post("/tournament/current/attempt/start")
    resp = await client.post(
        "/tournament/current/attempt/submit", json={"time_ms": 1, "status": "dnf"}
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["status"] == "dnf"

    await _register_and_login(client, email_spy, "dnf2@example.com")
    await client.post("/tournament/current/attempt/start")
    resp = await client.post(
        "/tournament/current/attempt/submit", json={"time_ms": 1, "status": "dnf"}
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["status"] == "dnf"

    resp = await client.get("/tournament/current/standings")
    assert resp.status_code == 200, resp.text
    body = resp.json()

    assert body["entries"] == []
    assert body["valid_count"] == 0
    assert body["dnf_count"] == 2
    assert body["your_entry"] is None


# --- standings: no rank field ----


async def test_standings_no_rank_field(client: AsyncClient, email_spy: EmailSpy) -> None:
    """Response JSON has no rank/position key."""
    await _register_and_login(client, email_spy, "norank@example.com")
    await client.post("/tournament/current/attempt/start")
    await client.post(
        "/tournament/current/attempt/submit", json={"time_ms": 5000, "status": "valid"}
    )

    resp = await client.get("/tournament/current/standings")
    assert resp.status_code == 200, resp.text
    body = resp.json()

    assert "rank" not in body
    assert "position" not in body
    for entry in body["entries"]:
        assert "rank" not in entry
        assert "position" not in entry


# --- standings: privacy (no email/nickname leak) ----


async def test_standings_no_email_no_nickname_leak(
    client: AsyncClient, email_spy: EmailSpy, session_maker: async_sessionmaker[AsyncSession]
) -> None:
    """Email "leaky@example.com" + nickname "Leaky" + public_handle=None → display_name "Аноним", no leak."""
    await _register_and_login(client, email_spy, "leaky@example.com")
    await client.post("/tournament/current/attempt/start")
    await client.post(
        "/tournament/current/attempt/submit", json={"time_ms": 5000, "status": "valid"}
    )

    # Manually set nickname (register doesn't usually expose it, but it's there on the model)
    async with session_maker() as session:
        user_result = await session.execute(select(User).where(User.email == "leaky@example.com"))
        user = user_result.scalars().first()
        assert user is not None
        user.nickname = "Leaky"
        session.add(user)
        await session.commit()

    resp = await client.get("/tournament/current/standings")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    response_text = str(body)

    # No email, no nickname, no "@" anywhere
    assert "leaky@example.com" not in response_text
    assert "Leaky" not in response_text
    assert "@" not in response_text
    assert body["entries"][0]["display_name"] == "Аноним"


# --- standings: public_handle shown ----


async def test_standings_public_handle_shown(
    client: AsyncClient, email_spy: EmailSpy, session_maker: async_sessionmaker[AsyncSession]
) -> None:
    """public_handle "SpeedCuber" → display_name "SpeedCuber"."""
    await _register_and_login(client, email_spy, "speedcuber@example.com")
    await client.post("/tournament/current/attempt/start")
    await client.post(
        "/tournament/current/attempt/submit", json={"time_ms": 5000, "status": "valid"}
    )

    # Set public_handle via PATCH
    resp = await client.patch("/users/me", json={"public_handle": "SpeedCuber"})
    assert resp.status_code == 200, resp.text

    resp = await client.get("/tournament/current/standings")
    assert resp.status_code == 200, resp.text
    body = resp.json()

    assert len(body["entries"]) == 1
    assert body["entries"][0]["display_name"] == "SpeedCuber"
    assert body["your_entry"]["display_name"] == "SpeedCuber"


# --- standings: no scramble in response ----


async def test_standings_no_scramble_in_body(client: AsyncClient, email_spy: EmailSpy) -> None:
    """DB scramble string absent from response body."""
    await _register_and_login(client, email_spy, "noscramble@example.com")
    start_resp = await client.post("/tournament/current/attempt/start")
    assert start_resp.status_code == 200, start_resp.text
    scramble_from_start = start_resp.json()["scramble"]
    assert scramble_from_start  # Start returns the scramble

    await client.post(
        "/tournament/current/attempt/submit", json={"time_ms": 5000, "status": "valid"}
    )

    resp = await client.get("/tournament/current/standings")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    response_text = str(body)

    assert scramble_from_start not in response_text


# --- standings: limit clamping ----


async def test_standings_limit_clamped(client: AsyncClient, email_spy: EmailSpy) -> None:
    """limit bounds the result; limit<=0 → 422."""
    # Create 5 valid attempts
    for i in range(5):
        await _register_and_login(client, email_spy, f"user{i}@example.com")
        await client.post("/tournament/current/attempt/start")
        await client.post(
            "/tournament/current/attempt/submit", json={"time_ms": 1000 + i, "status": "valid"}
        )

    # Request limit=2, should get exactly 2 even though 5 valid attempts exist
    resp = await client.get("/tournament/current/standings?limit=2")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert len(body["entries"]) == 2
    assert body["valid_count"] == 5  # Total count unchanged, but entries limited

    # Request limit > MAX should clamp to MAX
    resp = await client.get("/tournament/current/standings?limit=9999")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    # All 5 entries returned (< TOURNAMENT_STANDINGS_LIMIT_MAX which is 200)
    assert len(body["entries"]) == 5

    # limit <= 0 should reject
    resp = await client.get("/tournament/current/standings?limit=0")
    assert resp.status_code == 422, resp.text

    resp = await client.get("/tournament/current/standings?limit=-1")
    assert resp.status_code == 422, resp.text


# --- display_name_for (unit test) ----


def test_display_name_for_unit() -> None:
    """Pure: handle→handle; None→'Аноним'; never email/nickname."""
    assert tournament_service.display_name_for("SpeedCuber") == "SpeedCuber"
    assert tournament_service.display_name_for("") == "Аноним"  # Empty string treated as falsy
    assert tournament_service.display_name_for(None) == "Аноним"
    # Never called with email/nickname, but the function is simple and just returns the handle or default


# --- public_handle setting via PATCH /users/me ----


async def test_set_public_handle_via_patch_me(client: AsyncClient, email_spy: EmailSpy) -> None:
    """PATCH /users/me {public_handle:"X"} → GET /users/me shows it; ""→null; >64→422."""
    await _register_and_login(client, email_spy, "handle-test@example.com")

    # Set public_handle
    resp = await client.patch("/users/me", json={"public_handle": "MyHandle"})
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["public_handle"] == "MyHandle"

    # Read it back
    resp = await client.get("/users/me")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["public_handle"] == "MyHandle"

    # Empty string → null
    resp = await client.patch("/users/me", json={"public_handle": ""})
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["public_handle"] is None

    # Confirm it's null after read
    resp = await client.get("/users/me")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["public_handle"] is None

    # > 64 chars → 422
    long_handle = "x" * 65
    resp = await client.patch("/users/me", json={"public_handle": long_handle})
    assert resp.status_code == 422, resp.text

    # Whitespace trim
    resp = await client.patch("/users/me", json={"public_handle": "  TrimMe  "})
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["public_handle"] == "TrimMe"


# --- public_handle not leaked to others ----


async def test_public_handle_not_leaked_to_others(client: AsyncClient, email_spy: EmailSpy) -> None:
    """GET /users/me never exposes another user."""
    await _register_and_login(client, email_spy, "alice@example.com")
    resp = await client.patch("/users/me", json={"public_handle": "AliceHandle"})
    assert resp.status_code == 200, resp.text

    # Alice cannot read anyone else via /users/me
    await _register_and_login(client, email_spy, "bob@example.com")
    resp = await client.get("/users/me")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["email"] == "bob@example.com"
    assert body["public_handle"] is None  # Bob hasn't set one
