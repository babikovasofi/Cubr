"""Pure notify-decision rules for friend chat (plan §4, "правила уведомления
как проверяемые условия").

`decide()` touches NEITHER the clock NOR the database — everything it needs
comes in as arguments (`MessageSnapshot`, `NotifyContext`, `now`). That is
the whole point: the entire N1-N10 rule table is testable without a DB and
without mocking time. `now` is always UTC (mirrors `app.services.friends.
now_utc`) — callers must pass `now_utc()`, never a naive local time.

This module is Этап B plumbing written early (Этап A ships the
`notify_after`/`notify_state` COLUMNS but nothing in Этап A ever calls
`decide()` — see `app.models.chat` module docstring). The sweep job that
calls this in a loop over `chat_messages WHERE notify_state = 'pending'`
ships in Этап B (`app.jobs.chat_notify`), together with `chat_email_state`/
`email_prefs` and the email send itself.

Terminal-state precedence (first match wins) — chosen to match the plan's
narrative in §4, and each one is a distinct row in `CHAT_NOTIFY_STATES`
(`app.models.chat`):

1. `deleted_at is not None` (N10) — author deleted it; leave `pending`
   (harmless — it will simply never accumulate enough to send; not worth a
   dedicated terminal state).
2. Friendship no longer accepted (N8) -> `'unfriended'`. Belt-and-braces:
   `app.services.friends.remove_friend` already flips every PENDING message
   of the pair to `'unfriended'` synchronously at unfriend time (plan §4,
   "Дружба удалена" (а)) — this is the sweep's OWN re-check for the race
   where unfriending happens between two sweep passes (plan §4 (б)).
3. Recipient blocked the sender (N9) -> `'blocked'`.
4. Already read (N3 broken: `last_read_seq >= seq`) -> `'read'`.
5. Recipient came online strictly AFTER the message was created (N4
   broken) -> `'seen'`. This is checked unconditionally, not gated on N2 —
   see plan §4: "N4 ломается НАВСЕГДА для этого сообщения" the moment it
   happens, independent of whether the 5-minute delay has elapsed yet.
6. Daily per-conversation cap reached -> `'throttled_expired'` (plan §4,
   `CHAT_EMAIL_MAX_PER_CONVERSATION_PER_DAY`).
7. Recipient opted out of chat email (N6) -> `'unsubscribed'`. Does NOT
   affect in-app delivery — see plan §4 "Отписался".
8. Recipient inactive/unverified (N7) -> stays `pending` (no terminal state
   defined for this by the plan; a deactivated account may reactivate,
   verification may complete later — worth re-checking on the next pass).
9. `now < notify_after` (N2 not yet due) -> stays `pending`.
10. Hourly per-conversation-recipient throttle still cooling down (N5) ->
    stays `pending` (this is deliberately a NO-OP, not `'throttled_expired'`
    — see plan §4 "Час прошёл, а сообщения так и не прочитаны": the NEXT
    sweep pass must be free to send once the window reopens, not
    permanently suppressed; the Decidim bug this guards against).
11. Otherwise -> `'sent'`, `should_notify=True`.
"""

import uuid
from dataclasses import dataclass
from datetime import datetime


@dataclass(frozen=True)
class MessageSnapshot:
    """The one message `decide()` is evaluating."""

    seq: int
    sender_id: uuid.UUID
    created_at: datetime
    notify_after: datetime
    notify_state: str
    deleted_at: datetime | None


@dataclass(frozen=True)
class NotifyContext:
    """Everything about the recipient/conversation `decide()` needs,
    snapshotted by the caller (the Этап B sweep job) BEFORE calling
    `decide()` — no lazy DB access happens inside `decide()` itself.
    """

    recipient_last_read_seq: int
    recipient_last_seen_at: datetime | None
    recipient_is_active: bool
    recipient_is_verified: bool
    friendship_accepted: bool
    recipient_blocked_sender: bool
    recipient_chat_email_enabled: bool
    last_email_at: datetime | None
    email_interval_seconds: int
    emails_sent_today: int
    max_emails_per_conversation_per_day: int


@dataclass(frozen=True)
class Decision:
    """`should_notify`: include this message in the email about to be sent
    (or already being composed for this sweep pass). `next_state`: the
    `notify_state` to persist — `None` means "leave it `pending`, re-check
    on the next pass".
    """

    should_notify: bool
    next_state: str | None
    reason: str


def decide(msg: MessageSnapshot, ctx: NotifyContext, now: datetime) -> Decision:
    """See module docstring for the full precedence table (N1-N10)."""
    if msg.deleted_at is not None:
        return Decision(False, None, "deleted")

    if not ctx.friendship_accepted:
        return Decision(False, "unfriended", "unfriended")

    if ctx.recipient_blocked_sender:
        return Decision(False, "blocked", "blocked")

    if ctx.recipient_last_read_seq >= msg.seq:
        return Decision(False, "read", "read")

    if ctx.recipient_last_seen_at is not None and ctx.recipient_last_seen_at >= msg.created_at:
        return Decision(False, "seen", "seen")

    if ctx.emails_sent_today >= ctx.max_emails_per_conversation_per_day:
        return Decision(False, "throttled_expired", "daily_cap")

    if not ctx.recipient_chat_email_enabled:
        return Decision(False, "unsubscribed", "unsubscribed")

    if not (ctx.recipient_is_active and ctx.recipient_is_verified):
        return Decision(False, None, "recipient_not_eligible")

    if now < msg.notify_after:
        return Decision(False, None, "delay_not_elapsed")

    if ctx.last_email_at is not None:
        elapsed = (now - ctx.last_email_at).total_seconds()
        if elapsed < ctx.email_interval_seconds:
            return Decision(False, None, "hourly_throttle")

    return Decision(True, "sent", "ok")
