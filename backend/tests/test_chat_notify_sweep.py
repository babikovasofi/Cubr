"""`app.jobs.chat_notify.run` — the DB-touching Этап B sweep. Unlike
`tests/test_chat_notify.py` (pure `decide()` unit tests), this exercises
grouping, claiming, throttling, and email composition against a real
session — mirrors `tests/test_daily_finalize.py`'s shape (direct model
inserts, injected `now`, `monkeypatch.setattr("app.db.async_session_maker",
...)` so the job's own internal `from app.db import async_session_maker`
picks up the test engine — see `tests/conftest.py`'s `chat_client` fixture
docstring for why that patch is required).
"""

import uuid
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.jobs import chat_notify
from app.models import ChatEmailState, ChatMessage, Conversation, EmailPrefs, Friendship, User
from app.models.chat import ChatRead, UserPresence
from app.services.friends import pair_key

BASE_NOW = datetime(2026, 8, 24, 12, 0, 0, tzinfo=timezone.utc)
NOTIFY_DELAY = 300


class EmailSweepSpy:
    def __init__(self) -> None:
        self.calls: list[dict[str, object]] = []

    async def send(
        self,
        to: str,
        sender_handle: str,
        count: int,
        open_link: str,
        unsubscribe_link: str,
        list_unsubscribe_post_url: str,
    ) -> None:
        self.calls.append(
            {
                "to": to,
                "sender_handle": sender_handle,
                "count": count,
                "open_link": open_link,
                "unsubscribe_link": unsubscribe_link,
                "list_unsubscribe_post_url": list_unsubscribe_post_url,
            }
        )


@pytest.fixture
def email_spy(monkeypatch: pytest.MonkeyPatch) -> EmailSweepSpy:
    spy = EmailSweepSpy()
    monkeypatch.setattr(chat_notify, "send_chat_notification", spy.send)
    return spy


async def _insert_user(
    session: AsyncSession, email: str, handle: str, *, is_verified: bool = True
) -> User:
    user = User(
        email=email, hashed_password="dummy", handle=handle, is_verified=is_verified, is_active=True
    )
    session.add(user)
    await session.flush()
    return user


async def _befriend(session: AsyncSession, a: User, b: User) -> Friendship:
    low, high = pair_key(a.id, b.id)
    friendship = Friendship(
        user_low_id=low, user_high_id=high, requested_by_id=a.id, status="accepted"
    )
    session.add(friendship)
    await session.flush()
    return friendship


async def _conversation(session: AsyncSession, a: User, b: User) -> Conversation:
    low, high = pair_key(a.id, b.id)
    conv = Conversation(user_low_id=low, user_high_id=high, last_seq=0)
    session.add(conv)
    await session.flush()
    return conv


async def _pending_message(
    session: AsyncSession,
    conv: Conversation,
    sender: User,
    seq: int,
    *,
    created_at: datetime,
    notify_after: datetime | None = None,
) -> ChatMessage:
    msg = ChatMessage(
        conversation_id=conv.id,
        sender_id=sender.id,
        seq=seq,
        body=f"msg {seq}",
        created_at=created_at,
        notify_after=notify_after or (created_at + timedelta(seconds=NOTIFY_DELAY)),
        notify_state="pending",
    )
    session.add(msg)
    conv.last_seq = max(conv.last_seq, seq)
    await session.flush()
    return msg


@pytest.fixture(autouse=True)
def _patch_session_maker_and_clock(
    monkeypatch: pytest.MonkeyPatch, session_maker: async_sessionmaker[AsyncSession]
) -> None:
    """`chat_notify.run` opens its own session via a local `from app.db
    import async_session_maker` — patch the module attribute it reads at
    call time, same as `tests/conftest.py`'s `chat_client` fixture does for
    `app.routers.chat`. Also freezes `chat_notify`'s `now_utc()` to
    `BASE_NOW` — mirrors `tests/test_daily_finalize.py`'s
    `monkeypatch.setattr(finalize_module, "now_utc", lambda: now)` (the
    module-level imported name, not the real wall clock).
    """
    monkeypatch.setattr("app.db.async_session_maker", session_maker)
    monkeypatch.setattr(chat_notify, "now_utc", lambda: BASE_NOW)


# --------------------------------------------------------------------------- #
# happy path
# --------------------------------------------------------------------------- #


async def test_three_unread_messages_produce_one_email_all_marked_sent(
    session_maker: async_sessionmaker[AsyncSession], email_spy: EmailSweepSpy
) -> None:
    async with session_maker() as session:
        alice = await _insert_user(session, "alice@example.com", "alicehandle")
        bob = await _insert_user(session, "bob@example.com", "bobhandle")
        await _befriend(session, alice, bob)
        conv = await _conversation(session, alice, bob)
        created = BASE_NOW - timedelta(seconds=NOTIFY_DELAY + 1)
        for seq in (1, 2, 3):
            await _pending_message(session, conv, alice, seq, created_at=created)
        await session.commit()
        conv_id = conv.id

    count = await chat_notify.run()
    assert count == 3
    assert len(email_spy.calls) == 1
    call = email_spy.calls[0]
    assert call["to"] == "bob@example.com"
    assert call["sender_handle"] == "alicehandle"
    assert call["count"] == 3

    async with session_maker() as session:
        result = await session.execute(
            select(ChatMessage.notify_state).where(ChatMessage.conversation_id == conv_id)
        )
        states = [row[0] for row in result.all()]
        assert states == ["sent", "sent", "sent"]

        state = await session.get(ChatEmailState, (conv_id, (await _bob_id(session))))
        assert state is not None
        assert state.emails_sent == 1
        assert state.last_email_at is not None


async def _bob_id(session: AsyncSession) -> uuid.UUID:
    result = await session.execute(select(User.id).where(User.email == "bob@example.com"))
    return result.scalar_one()


async def test_zero_pending_messages_logs_and_returns_zero(
    session_maker: async_sessionmaker[AsyncSession], email_spy: EmailSweepSpy
) -> None:
    count = await chat_notify.run()
    assert count == 0
    assert email_spy.calls == []


# --------------------------------------------------------------------------- #
# idempotency under overlapping runs
# --------------------------------------------------------------------------- #


async def test_two_runs_in_a_row_send_exactly_one_email(
    session_maker: async_sessionmaker[AsyncSession], email_spy: EmailSweepSpy
) -> None:
    async with session_maker() as session:
        alice = await _insert_user(session, "alice@example.com", "alicehandle")
        bob = await _insert_user(session, "bob@example.com", "bobhandle")
        await _befriend(session, alice, bob)
        conv = await _conversation(session, alice, bob)
        created = BASE_NOW - timedelta(seconds=NOTIFY_DELAY + 1)
        await _pending_message(session, conv, alice, 1, created_at=created)
        await session.commit()

    first = await chat_notify.run()
    second = await chat_notify.run()
    assert first == 1
    assert second == 0
    assert len(email_spy.calls) == 1


async def test_message_already_claimed_by_concurrent_run_is_not_resent(
    session_maker: async_sessionmaker[AsyncSession], email_spy: EmailSweepSpy
) -> None:
    """Simulates the race directly: the claim UPDATE re-guards
    `notify_state = 'pending'`, so a message another (concurrent) run
    already flipped to `'sent'` is not picked up again.
    """
    async with session_maker() as session:
        alice = await _insert_user(session, "alice@example.com", "alicehandle")
        bob = await _insert_user(session, "bob@example.com", "bobhandle")
        await _befriend(session, alice, bob)
        conv = await _conversation(session, alice, bob)
        created = BASE_NOW - timedelta(seconds=NOTIFY_DELAY + 1)
        msg = await _pending_message(session, conv, alice, 1, created_at=created)
        # Simulate a concurrent run winning the race.
        msg.notify_state = "sent"
        await session.commit()

    count = await chat_notify.run()
    assert count == 0
    assert email_spy.calls == []


# --------------------------------------------------------------------------- #
# hourly throttle / Decidim regression
# --------------------------------------------------------------------------- #


async def test_hourly_throttle_blocks_second_email_within_window(
    session_maker: async_sessionmaker[AsyncSession], email_spy: EmailSweepSpy
) -> None:
    async with session_maker() as session:
        alice = await _insert_user(session, "alice@example.com", "alicehandle")
        bob = await _insert_user(session, "bob@example.com", "bobhandle")
        await _befriend(session, alice, bob)
        conv = await _conversation(session, alice, bob)
        created = BASE_NOW - timedelta(seconds=NOTIFY_DELAY + 1)
        await _pending_message(session, conv, alice, 1, created_at=created)
        session.add(
            ChatEmailState(
                conversation_id=conv.id,
                recipient_id=bob.id,
                last_email_at=BASE_NOW - timedelta(seconds=1000),
                emails_sent=1,
            )
        )
        await session.commit()

    count = await chat_notify.run()
    assert count == 0
    assert email_spy.calls == []


async def test_decidim_bug_second_email_after_hour_still_sends(
    session_maker: async_sessionmaker[AsyncSession], email_spy: EmailSweepSpy
) -> None:
    """Plan §1.1/§8: unread for over an hour -> a SECOND email, not
    permanent suppression.
    """
    async with session_maker() as session:
        alice = await _insert_user(session, "alice@example.com", "alicehandle")
        bob = await _insert_user(session, "bob@example.com", "bobhandle")
        await _befriend(session, alice, bob)
        conv = await _conversation(session, alice, bob)
        created = BASE_NOW - timedelta(seconds=NOTIFY_DELAY + 1)
        await _pending_message(session, conv, alice, 1, created_at=created)
        session.add(
            ChatEmailState(
                conversation_id=conv.id,
                recipient_id=bob.id,
                last_email_at=BASE_NOW - timedelta(seconds=3601),
                emails_sent=1,
            )
        )
        await session.commit()
        conv_id = conv.id

    count = await chat_notify.run()
    assert count == 1
    assert len(email_spy.calls) == 1

    async with session_maker() as session:
        state = await session.get(ChatEmailState, (conv_id, await _bob_id(session)))
        assert state is not None
        assert state.emails_sent == 2


# --------------------------------------------------------------------------- #
# daily cap
# --------------------------------------------------------------------------- #


async def test_fourth_email_of_the_day_is_throttled_expired(
    session_maker: async_sessionmaker[AsyncSession], email_spy: EmailSweepSpy
) -> None:
    async with session_maker() as session:
        alice = await _insert_user(session, "alice@example.com", "alicehandle")
        bob = await _insert_user(session, "bob@example.com", "bobhandle")
        await _befriend(session, alice, bob)
        conv = await _conversation(session, alice, bob)
        created = BASE_NOW - timedelta(seconds=NOTIFY_DELAY + 1)
        msg = await _pending_message(session, conv, alice, 1, created_at=created)
        session.add(
            ChatEmailState(
                conversation_id=conv.id,
                recipient_id=bob.id,
                last_email_at=BASE_NOW - timedelta(seconds=3601),
                emails_sent=3,
            )
        )
        await session.commit()
        msg_id = msg.id

    count = await chat_notify.run()
    assert count == 0
    assert email_spy.calls == []

    async with session_maker() as session:
        state = await session.get(ChatMessage, msg_id)
        assert state is not None
        assert state.notify_state == "throttled_expired"


# --------------------------------------------------------------------------- #
# N4 seen / N8 unfriended / N9 blocked -> terminal, no email
# --------------------------------------------------------------------------- #


async def test_recipient_seen_marks_seen_no_email(
    session_maker: async_sessionmaker[AsyncSession], email_spy: EmailSweepSpy
) -> None:
    async with session_maker() as session:
        alice = await _insert_user(session, "alice@example.com", "alicehandle")
        bob = await _insert_user(session, "bob@example.com", "bobhandle")
        await _befriend(session, alice, bob)
        conv = await _conversation(session, alice, bob)
        created = BASE_NOW - timedelta(seconds=NOTIFY_DELAY + 1)
        msg = await _pending_message(session, conv, alice, 1, created_at=created)
        session.add(UserPresence(user_id=bob.id, last_seen_at=created + timedelta(seconds=1)))
        await session.commit()
        msg_id = msg.id

    count = await chat_notify.run()
    assert count == 0
    assert email_spy.calls == []

    async with session_maker() as session:
        m = await session.get(ChatMessage, msg_id)
        assert m is not None
        assert m.notify_state == "seen"


async def test_already_read_marks_read_no_email(
    session_maker: async_sessionmaker[AsyncSession], email_spy: EmailSweepSpy
) -> None:
    async with session_maker() as session:
        alice = await _insert_user(session, "alice@example.com", "alicehandle")
        bob = await _insert_user(session, "bob@example.com", "bobhandle")
        await _befriend(session, alice, bob)
        conv = await _conversation(session, alice, bob)
        created = BASE_NOW - timedelta(seconds=NOTIFY_DELAY + 1)
        msg = await _pending_message(session, conv, alice, 1, created_at=created)
        session.add(ChatRead(conversation_id=conv.id, user_id=bob.id, last_read_seq=1))
        await session.commit()
        msg_id = msg.id

    count = await chat_notify.run()
    assert count == 0

    async with session_maker() as session:
        m = await session.get(ChatMessage, msg_id)
        assert m is not None
        assert m.notify_state == "read"


async def test_unfriended_marks_unfriended_no_email(
    session_maker: async_sessionmaker[AsyncSession], email_spy: EmailSweepSpy
) -> None:
    async with session_maker() as session:
        alice = await _insert_user(session, "alice@example.com", "alicehandle")
        bob = await _insert_user(session, "bob@example.com", "bobhandle")
        # Deliberately no accepted friendship inserted.
        conv = await _conversation(session, alice, bob)
        created = BASE_NOW - timedelta(seconds=NOTIFY_DELAY + 1)
        msg = await _pending_message(session, conv, alice, 1, created_at=created)
        await session.commit()
        msg_id = msg.id

    count = await chat_notify.run()
    assert count == 0
    assert email_spy.calls == []

    async with session_maker() as session:
        m = await session.get(ChatMessage, msg_id)
        assert m is not None
        assert m.notify_state == "unfriended"


# --------------------------------------------------------------------------- #
# recipient not verified -> stays pending, no email
# --------------------------------------------------------------------------- #


async def test_unverified_recipient_stays_pending_no_email(
    session_maker: async_sessionmaker[AsyncSession], email_spy: EmailSweepSpy
) -> None:
    async with session_maker() as session:
        alice = await _insert_user(session, "alice@example.com", "alicehandle")
        bob = await _insert_user(session, "bob@example.com", "bobhandle", is_verified=False)
        await _befriend(session, alice, bob)
        conv = await _conversation(session, alice, bob)
        created = BASE_NOW - timedelta(seconds=NOTIFY_DELAY + 1)
        msg = await _pending_message(session, conv, alice, 1, created_at=created)
        await session.commit()
        msg_id = msg.id

    count = await chat_notify.run()
    assert count == 0
    assert email_spy.calls == []

    async with session_maker() as session:
        m = await session.get(ChatMessage, msg_id)
        assert m is not None
        assert m.notify_state == "pending"


# --------------------------------------------------------------------------- #
# unsubscribed recipient -> terminal, no email
# --------------------------------------------------------------------------- #


async def test_unsubscribed_recipient_marks_unsubscribed_no_email(
    session_maker: async_sessionmaker[AsyncSession], email_spy: EmailSweepSpy
) -> None:
    async with session_maker() as session:
        alice = await _insert_user(session, "alice@example.com", "alicehandle")
        bob = await _insert_user(session, "bob@example.com", "bobhandle")
        await _befriend(session, alice, bob)
        conv = await _conversation(session, alice, bob)
        created = BASE_NOW - timedelta(seconds=NOTIFY_DELAY + 1)
        msg = await _pending_message(session, conv, alice, 1, created_at=created)
        session.add(EmailPrefs(user_id=bob.id, chat_email_enabled=False))
        await session.commit()
        msg_id = msg.id

    count = await chat_notify.run()
    assert count == 0
    assert email_spy.calls == []

    async with session_maker() as session:
        m = await session.get(ChatMessage, msg_id)
        assert m is not None
        assert m.notify_state == "unsubscribed"


# --------------------------------------------------------------------------- #
# bundling: an undue message rides along with a due one in the same email
# --------------------------------------------------------------------------- #


async def test_not_yet_due_message_bundles_into_a_triggered_email(
    session_maker: async_sessionmaker[AsyncSession], email_spy: EmailSweepSpy
) -> None:
    async with session_maker() as session:
        alice = await _insert_user(session, "alice@example.com", "alicehandle")
        bob = await _insert_user(session, "bob@example.com", "bobhandle")
        await _befriend(session, alice, bob)
        conv = await _conversation(session, alice, bob)
        due_created = BASE_NOW - timedelta(seconds=NOTIFY_DELAY + 1)
        not_due_created = BASE_NOW  # notify_after in the future
        await _pending_message(session, conv, alice, 1, created_at=due_created)
        await _pending_message(session, conv, alice, 2, created_at=not_due_created)
        await session.commit()
        conv_id = conv.id

    count = await chat_notify.run()
    assert count == 2
    assert len(email_spy.calls) == 1
    assert email_spy.calls[0]["count"] == 2

    async with session_maker() as session:
        result = await session.execute(
            select(ChatMessage.notify_state).where(ChatMessage.conversation_id == conv_id)
        )
        assert [row[0] for row in result.all()] == ["sent", "sent"]


# --------------------------------------------------------------------------- #
# mail failure: swallowed, doesn't crash the sweep, message stays sent
# --------------------------------------------------------------------------- #


async def test_mail_failure_does_not_crash_sweep(
    session_maker: async_sessionmaker[AsyncSession], monkeypatch: pytest.MonkeyPatch
) -> None:
    async def _boom(**kwargs: object) -> None:
        raise RuntimeError("provider is down")

    monkeypatch.setattr(chat_notify, "send_chat_notification", _boom)

    async with session_maker() as session:
        alice = await _insert_user(session, "alice@example.com", "alicehandle")
        bob = await _insert_user(session, "bob@example.com", "bobhandle")
        await _befriend(session, alice, bob)
        conv = await _conversation(session, alice, bob)
        created = BASE_NOW - timedelta(seconds=NOTIFY_DELAY + 1)
        msg = await _pending_message(session, conv, alice, 1, created_at=created)
        await session.commit()
        msg_id = msg.id

    count = await chat_notify.run()  # must not raise
    assert count == 1

    async with session_maker() as session:
        m = await session.get(ChatMessage, msg_id)
        assert m is not None
        # Claimed BEFORE the send attempt (plan §4: mark-then-send, so a
        # blown send loses the notification, never duplicates it).
        assert m.notify_state == "sent"
