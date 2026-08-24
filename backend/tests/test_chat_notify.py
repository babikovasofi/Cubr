"""Pure unit tests for `app.services.chat_notify.decide` — no DB, no clock
mocking beyond passing an explicit `now`. Covers plan §4 (N1-N10) and §8's
"Границы" boundary cases for the notify rule table.
"""

import uuid
from datetime import datetime, timedelta, timezone

import pytest

from app.services.chat_notify import Decision, MessageSnapshot, NotifyContext, decide

SENDER = uuid.uuid4()
EMAIL_INTERVAL = 3600
DAILY_CAP = 3


def _now() -> datetime:
    return datetime(2026, 8, 24, 12, 0, 0, tzinfo=timezone.utc)


def _msg(
    *,
    seq: int = 1,
    created_at: datetime | None = None,
    notify_after: datetime | None = None,
    deleted_at: datetime | None = None,
) -> MessageSnapshot:
    created = created_at if created_at is not None else _now() - timedelta(seconds=301)
    after = notify_after if notify_after is not None else created + timedelta(seconds=300)
    return MessageSnapshot(
        seq=seq,
        sender_id=SENDER,
        created_at=created,
        notify_after=after,
        notify_state="pending",
        deleted_at=deleted_at,
    )


def _ctx(
    *,
    last_read_seq: int = 0,
    last_seen_at: datetime | None = None,
    is_active: bool = True,
    is_verified: bool = True,
    friendship_accepted: bool = True,
    blocked: bool = False,
    email_enabled: bool = True,
    last_email_at: datetime | None = None,
    emails_sent_today: int = 0,
) -> NotifyContext:
    return NotifyContext(
        recipient_last_read_seq=last_read_seq,
        recipient_last_seen_at=last_seen_at,
        recipient_is_active=is_active,
        recipient_is_verified=is_verified,
        friendship_accepted=friendship_accepted,
        recipient_blocked_sender=blocked,
        recipient_chat_email_enabled=email_enabled,
        last_email_at=last_email_at,
        email_interval_seconds=EMAIL_INTERVAL,
        emails_sent_today=emails_sent_today,
        max_emails_per_conversation_per_day=DAILY_CAP,
    )


# --- Happy path -------------------------------------------------------------


def test_offline_five_minutes_no_prior_email_sends() -> None:
    """decide(): one message, recipient never on site, 5 minutes elapsed,
    no prior email -> 'sent' (plan §8 happy path bullet)."""
    decision = decide(_msg(), _ctx(), _now())
    assert decision == Decision(True, "sent", "ok")


# --- N2: notify delay boundary ----------------------------------------------


def test_delay_not_yet_elapsed_does_not_send() -> None:
    now = _now()
    msg = _msg(notify_after=now + timedelta(microseconds=1))
    decision = decide(msg, _ctx(), now)
    assert decision.should_notify is False
    assert decision.next_state is None
    assert decision.reason == "delay_not_elapsed"


def test_delay_exactly_elapsed_sends() -> None:
    now = _now()
    msg = _msg(notify_after=now)
    decision = decide(msg, _ctx(), now)
    assert decision.should_notify is True
    assert decision.next_state == "sent"


# --- N4: presence / "seen" ---------------------------------------------------


def test_last_seen_exactly_equal_to_created_at_is_online() -> None:
    """N4 requires strict `<` for offline — equal counts as online (plan §8:
    "last_seen_at ровно равен created_at -> онлайн")."""
    created = _now() - timedelta(seconds=301)
    msg = _msg(created_at=created)
    decision = decide(msg, _ctx(last_seen_at=created), _now())
    assert decision == Decision(False, "seen", "seen")


def test_last_seen_one_microsecond_before_created_at_is_offline() -> None:
    created = _now() - timedelta(seconds=301)
    decision = decide(
        _msg(created_at=created),
        _ctx(last_seen_at=created - timedelta(microseconds=1)),
        _now(),
    )
    assert decision.should_notify is True


def test_seen_overrides_even_before_delay_elapsed() -> None:
    """N4 breaking is permanent regardless of whether N2 has elapsed yet —
    plan §4: "N4 ломается НАВСЕГДА для этого сообщения"."""
    now = _now()
    created = now - timedelta(seconds=1)  # delay nowhere near elapsed
    msg = _msg(created_at=created, notify_after=created + timedelta(seconds=300))
    decision = decide(msg, _ctx(last_seen_at=created), now)
    assert decision == Decision(False, "seen", "seen")


# --- N3: already read --------------------------------------------------------


def test_already_read_does_not_send() -> None:
    decision = decide(_msg(seq=5), _ctx(last_read_seq=5), _now())
    assert decision == Decision(False, "read", "read")


def test_read_cursor_below_seq_still_sends() -> None:
    decision = decide(_msg(seq=5), _ctx(last_read_seq=4), _now())
    assert decision.should_notify is True


# --- N5: hourly per-conversation-recipient throttle -------------------------


def test_hourly_window_3599_seconds_does_not_send() -> None:
    now = _now()
    decision = decide(_msg(), _ctx(last_email_at=now - timedelta(seconds=3599)), now)
    assert decision.should_notify is False
    assert decision.next_state is None  # NOT throttled_expired — see Decidim note
    assert decision.reason == "hourly_throttle"


def test_hourly_window_exactly_3600_seconds_sends() -> None:
    now = _now()
    decision = decide(_msg(), _ctx(last_email_at=now - timedelta(seconds=3600)), now)
    assert decision.should_notify is True


def test_decidim_bug_second_message_after_hour_sends_second_email() -> None:
    """Plan §1.1 / §8: an hour passing without the recipient reading must
    produce a SECOND email (throttling, not permanent suppression)."""
    now = _now()
    ctx = _ctx(last_email_at=now - timedelta(hours=1))
    decision = decide(_msg(seq=2), ctx, now)
    assert decision == Decision(True, "sent", "ok")


# --- Daily cap ----------------------------------------------------------------


def test_third_email_of_the_day_sends() -> None:
    decision = decide(_msg(), _ctx(emails_sent_today=2), _now())
    assert decision.should_notify is True


def test_fourth_email_of_the_day_is_throttled_expired() -> None:
    decision = decide(_msg(), _ctx(emails_sent_today=3), _now())
    assert decision == Decision(False, "throttled_expired", "daily_cap")


# --- N8/N9: unfriended / blocked ---------------------------------------------


def test_unfriended_never_sends() -> None:
    decision = decide(_msg(), _ctx(friendship_accepted=False), _now())
    assert decision == Decision(False, "unfriended", "unfriended")


def test_blocked_never_sends() -> None:
    decision = decide(_msg(), _ctx(blocked=True), _now())
    assert decision == Decision(False, "blocked", "blocked")


def test_unfriended_takes_precedence_over_blocked_check() -> None:
    decision = decide(_msg(), _ctx(friendship_accepted=False, blocked=True), _now())
    assert decision.next_state == "unfriended"


# --- N6/N7: email prefs / recipient eligibility ------------------------------


def test_unsubscribed_recipient_does_not_send() -> None:
    decision = decide(_msg(), _ctx(email_enabled=False), _now())
    assert decision == Decision(False, "unsubscribed", "unsubscribed")


def test_inactive_recipient_does_not_send_and_stays_pending() -> None:
    decision = decide(_msg(), _ctx(is_active=False), _now())
    assert decision.should_notify is False
    assert decision.next_state is None


def test_unverified_recipient_does_not_send_and_stays_pending() -> None:
    decision = decide(_msg(), _ctx(is_verified=False), _now())
    assert decision.should_notify is False
    assert decision.next_state is None


# --- N10: deleted -------------------------------------------------------------


def test_deleted_message_never_sends() -> None:
    decision = decide(_msg(deleted_at=_now()), _ctx(), _now())
    assert decision.should_notify is False
    assert decision.reason == "deleted"


@pytest.mark.parametrize("emails_sent_today", [0, 1, 2])
def test_below_daily_cap_never_returns_throttled_expired(emails_sent_today: int) -> None:
    decision = decide(_msg(), _ctx(emails_sent_today=emails_sent_today), _now())
    assert decision.next_state != "throttled_expired"
