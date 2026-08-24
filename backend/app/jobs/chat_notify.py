"""Chat-email sweep — Этап B of the friend-chat plan. The artifact an
EXTERNAL scheduler (system cron, alongside `app.jobs.finalize` — see
`docs/deploy.md` §7) invokes once a minute, not an in-process scheduler.

Uses `app.services.chat_notify.decide()` (Этап A/pure) for the per-message
rule table (N1-N10) but adds the DB-touching orchestration `decide()`
deliberately does NOT do:

* **Grouping by (conversation, recipient)**: at most ONE email per pass per
  pair, covering every `pending` message from that conversation's other
  participant — including ones whose own `notify_after` (N2) hasn't
  elapsed yet, as long as some OTHER message in the same group already
  cleared every gate (plan §4, "Несколько сообщений подряд"). `decide()`
  itself has no notion of "bundle" — a message evaluated on its own with
  `now < notify_after` always says "leave pending" (reason
  `delay_not_elapsed`). This module recognizes that specific reason (and
  `hourly_throttle`) as "would send but for timing, and timing already
  cleared for a sibling in this pass" and pulls it into the same email.
  Looking at `decide()`'s branch order, every check that comes BEFORE the
  N2/N5 timing checks (deleted/friendship/blocked/read/seen/daily-cap) has
  already been evaluated and passed for a message returned with reason
  `delay_not_elapsed`/`hourly_throttle` — so bundling it costs nothing
  extra to re-verify.
* **Idempotency under overlapping runs** (mirrors `app.jobs.finalize`):
  messages are claimed with `UPDATE ... WHERE notify_state = 'pending'
  RETURNING id`, committed, and ONLY THEN is the email sent — see
  `_claim_and_send`'s docstring for why that specific order (not the
  reverse) is the deliberate choice.
* **The hourly throttle (N5) and daily cap**: both live in
  `chat_email_state`, snapshotted into `NotifyContext` BEFORE calling
  `decide()`, and written back AFTER a successful claim.

Run directly:

    cd backend && uv run python -m app.jobs.chat_notify
"""

import asyncio
import logging
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import Settings, get_settings
from app.models.chat import ChatEmailState, ChatMessage, ChatRead, Conversation, UserPresence
from app.models.friendship import Friendship
from app.models.user import User
from app.services import email_prefs as email_prefs_service
from app.services import unsubscribe_token
from app.services.chat import is_blocked
from app.services.chat_notify import Decision, MessageSnapshot, NotifyContext, decide
from app.services.email import send_chat_notification
from app.services.friends import now_utc, pair_key
from app.services.tournament import display_name_for

logger = logging.getLogger("cubr.jobs.chat_notify")

# Reasons `decide()` returns that mean "would send, but only timing (N2/N5)
# is holding it back" — see module docstring's bundling explanation. Every
# check that comes BEFORE these two in `decide()`'s branch order has
# already passed by the time either of these reasons is returned.
_BUNDLABLE_REASONS = frozenset({"delay_not_elapsed", "hourly_throttle"})


def _as_utc(value: datetime) -> datetime:
    """sqlite (tests) reads `DateTime(timezone=True)` columns back as
    naive — Postgres does not. Normalize to UTC before comparing/
    subtracting so this module behaves identically on both (same fix as
    `app.services.chat.touch_presence`).
    """
    return value if value.tzinfo is not None else value.replace(tzinfo=timezone.utc)


@dataclass
class SweepSummary:
    """Logged once per run (`chat_notify_sweep`) — every run, including a
    zero one (plan §9, "Cron не запустился... и никто не знает").
    """

    groups_considered: int = 0
    emails_sent: int = 0
    messages_notified: int = 0
    messages_suppressed: int = 0

    def as_log_extra(self) -> dict[str, int]:
        return {
            "groups_considered": self.groups_considered,
            "emails_sent": self.emails_sent,
            "messages_notified": self.messages_notified,
            "messages_suppressed": self.messages_suppressed,
        }


async def _due_conversation_sender_pairs(
    session: AsyncSession, now: datetime
) -> list[tuple[uuid.UUID, uuid.UUID]]:
    """Every DISTINCT `(conversation_id, sender_id)` with at least one
    `pending` message past its `notify_after` — the partial index
    `ix_chat_messages_notify` backs this. `sender_id` here doubles as "who
    the recipient is NOT" (a 1:1 conversation has exactly one other
    participant).
    """
    result = await session.execute(
        select(ChatMessage.conversation_id, ChatMessage.sender_id)
        .where(ChatMessage.notify_state == "pending", ChatMessage.notify_after <= now)
        .distinct()
    )
    return [(row[0], row[1]) for row in result.all()]


async def _build_context(
    session: AsyncSession,
    conversation: Conversation,
    recipient: User,
    sender_id: uuid.UUID,
    settings: Settings,
    now: datetime,
) -> NotifyContext:
    read = await session.get(ChatRead, (conversation.id, recipient.id))
    last_read_seq = read.last_read_seq if read is not None else 0

    presence = await session.get(UserPresence, recipient.id)
    last_seen_at = _as_utc(presence.last_seen_at) if presence is not None else None

    low, high = pair_key(conversation.user_low_id, conversation.user_high_id)
    friendship_result = await session.execute(
        select(Friendship.status).where(
            Friendship.user_low_id == low, Friendship.user_high_id == high
        )
    )
    status = friendship_result.scalar_one_or_none()
    friendship_accepted = status == "accepted"

    blocked = await is_blocked(session, recipient.id, sender_id)
    chat_email_enabled = await email_prefs_service.get_chat_email_enabled(session, recipient.id)

    state = await session.get(ChatEmailState, (conversation.id, recipient.id))
    last_email_at = (
        _as_utc(state.last_email_at) if state is not None and state.last_email_at else None
    )
    # Daily cap resets with the calendar day (UTC) — see
    # `app.models.chat.ChatEmailState`'s docstring: no separate "date"
    # column, the day is derived from `last_email_at`.
    emails_sent_today = 0
    if state is not None and last_email_at is not None and last_email_at.date() == now.date():
        emails_sent_today = state.emails_sent

    return NotifyContext(
        recipient_last_read_seq=last_read_seq,
        recipient_last_seen_at=last_seen_at,
        recipient_is_active=recipient.is_active,
        recipient_is_verified=recipient.is_verified,
        friendship_accepted=friendship_accepted,
        recipient_blocked_sender=blocked,
        recipient_chat_email_enabled=chat_email_enabled,
        last_email_at=last_email_at,
        email_interval_seconds=settings.CHAT_EMAIL_INTERVAL_SECONDS,
        emails_sent_today=emails_sent_today,
        max_emails_per_conversation_per_day=settings.CHAT_EMAIL_MAX_PER_CONVERSATION_PER_DAY,
    )


async def _claim_and_send(
    session: AsyncSession,
    conversation_id: uuid.UUID,
    recipient: User,
    sender: User,
    message_ids: list[uuid.UUID],
    emails_sent_today: int,
    now: datetime,
    settings: Settings,
) -> int:
    """Claim `message_ids` as `'sent'` (re-guarded UPDATE), commit, bump
    `chat_email_state`, commit again, and ONLY THEN send the email.

    Mark-then-send (not the reverse): if the process dies between the claim
    commit and the send, the messages are already `'sent'` and no further
    sweep pass will retry them — one notification is silently lost. If we
    sent first and marked after, a crash between those two steps would
    leave the messages `'pending'`, and the NEXT sweep pass would re-send
    the same email — a duplicate. Plan §4: "Потерянное уведомление лучше
    дубликата — и это осознанный выбор, а не случайность." Returns the
    number of messages actually claimed (0 if a concurrent run already
    claimed them all — the caller must not send an email for 0 messages).
    """
    result = await session.execute(
        update(ChatMessage)
        .where(ChatMessage.id.in_(message_ids), ChatMessage.notify_state == "pending")
        .values(notify_state="sent", notify_resolved_at=now)
        .returning(ChatMessage.id)
    )
    claimed_ids = [row[0] for row in result.all()]
    if not claimed_ids:
        await session.commit()
        return 0

    state = await session.get(ChatEmailState, (conversation_id, recipient.id))
    if state is None:
        state = ChatEmailState(conversation_id=conversation_id, recipient_id=recipient.id)
        session.add(state)
    state.last_email_at = now
    state.emails_sent = emails_sent_today + 1
    await session.commit()

    links = unsubscribe_token.build_links(
        recipient.id,
        # A fresh `EmailPrefs` row (lazily created above via
        # `get_chat_email_enabled`) doesn't exist yet if this is the FIRST
        # email this user has ever gotten — re-read the current version
        # rather than assume 1, in case a prefs toggle raced this sweep.
        (await email_prefs_service.get_or_create_prefs(session, recipient.id)).token_version,
        settings.UNSUBSCRIBE_SIGN_SECRET,
        settings.FRONTEND_URL,
    )
    await session.commit()

    sender_handle = display_name_for(sender.handle)
    try:
        await send_chat_notification(
            to=recipient.email,
            sender_handle=sender_handle,
            count=len(claimed_ids),
            open_link=f"{settings.FRONTEND_URL}/friends",
            unsubscribe_link=links.page_url,
            list_unsubscribe_post_url=links.list_unsubscribe_post_url,
        )
    except Exception:
        # `send_chat_notification` -> `email._send` already logs+swallows
        # provider errors; this is a last-resort net for anything that
        # somehow escapes that (a bug in template rendering, say) — the
        # sweep as a whole must survive one bad conversation and keep
        # processing the rest (plan §9, "Cron не запустился... и никто не
        # знает" — a crash here would silently stop EVERY later group in
        # this pass, not just this one).
        logger.exception(
            "chat_notify: unexpected error composing/sending notification",
            extra={"conversation_id": str(conversation_id), "recipient_id": str(recipient.id)},
        )
        return len(claimed_ids)

    logger.info(
        "chat_email_sent",
        extra={
            "recipient_id": str(recipient.id),
            "conversation_id": str(conversation_id),
            "message_count": len(claimed_ids),
        },
    )
    return len(claimed_ids)


async def _apply_terminal(session: AsyncSession, message_id: uuid.UUID, next_state: str) -> None:
    """Persist a genuinely terminal `decide()` outcome (not `'sent'` — that
    goes through `_claim_and_send`'s bulk claim instead) for ONE message,
    re-guarding `notify_state = 'pending'` — mirrors the claim's race
    safety even though a lost race here is harmless (the state was already
    written by whoever won).
    """
    await session.execute(
        update(ChatMessage)
        .where(ChatMessage.id == message_id, ChatMessage.notify_state == "pending")
        .values(notify_state=next_state, notify_resolved_at=now_utc())
    )


async def _process_group(
    session: AsyncSession,
    conversation: Conversation,
    recipient: User,
    sender: User,
    settings: Settings,
    now: datetime,
    summary: SweepSummary,
) -> None:
    summary.groups_considered += 1

    pending_result = await session.execute(
        select(ChatMessage)
        .where(
            ChatMessage.conversation_id == conversation.id,
            ChatMessage.sender_id == sender.id,
            ChatMessage.notify_state == "pending",
        )
        .order_by(ChatMessage.seq)
    )
    pending_messages = list(pending_result.scalars().all())
    if not pending_messages:
        return

    ctx = await _build_context(session, conversation, recipient, sender.id, settings, now)

    decisions: list[tuple[ChatMessage, Decision]] = [
        (
            msg,
            decide(
                MessageSnapshot(
                    seq=msg.seq,
                    sender_id=msg.sender_id,
                    created_at=_as_utc(msg.created_at),
                    notify_after=_as_utc(msg.notify_after),
                    notify_state=msg.notify_state,
                    deleted_at=msg.deleted_at,
                ),
                ctx,
                now,
            ),
        )
        for msg in pending_messages
    ]

    triggered = any(d.should_notify for _, d in decisions)

    to_send: list[ChatMessage] = []
    to_terminal: list[tuple[ChatMessage, str]] = []
    for msg, d in decisions:
        if d.should_notify:
            to_send.append(msg)
        elif triggered and d.next_state is None and d.reason in _BUNDLABLE_REASONS:
            to_send.append(msg)
        elif d.next_state is not None:
            to_terminal.append((msg, d.next_state))
        # else: genuinely not due yet / not triggered this pass -> leave pending.

    for msg, next_state in to_terminal:
        await _apply_terminal(session, msg.id, next_state)
    if to_terminal:
        await session.commit()

    if not to_send:
        summary.messages_suppressed += len(to_terminal)
        return

    sent_count = await _claim_and_send(
        session,
        conversation.id,
        recipient,
        sender,
        [m.id for m in to_send],
        ctx.emails_sent_today,
        now,
        settings,
    )
    summary.messages_suppressed += len(to_terminal)
    summary.messages_notified += sent_count
    if sent_count > 0:
        summary.emails_sent += 1


async def run() -> int:
    """Sweep once. Opens its own session (mirrors `app.jobs.finalize`),
    logs `chat_notify_sweep` unconditionally (even zero groups), returns
    the number of messages that ended up `'sent'` this pass.
    """
    from app.db import async_session_maker

    settings = get_settings()
    now = now_utc()
    summary = SweepSummary()

    async with async_session_maker() as session:
        pairs = await _due_conversation_sender_pairs(session, now)
        for conversation_id, sender_id in pairs:
            conversation = await session.get(Conversation, conversation_id)
            if conversation is None:
                continue
            recipient_id = (
                conversation.user_high_id
                if conversation.user_low_id == sender_id
                else conversation.user_low_id
            )
            recipient = await session.get(User, recipient_id)
            sender = await session.get(User, sender_id)
            if recipient is None or sender is None:
                continue
            await _process_group(session, conversation, recipient, sender, settings, now, summary)

    logger.info("chat_notify_sweep", extra=summary.as_log_extra())
    return summary.messages_notified


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    asyncio.run(run())
