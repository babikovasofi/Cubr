"""Friend-to-friend private chat — Этап A of the friend-chat plan (переписка,
без единого письма). Mirrors `app.models.friendship`'s style: `GUID`,
`CheckConstraint`, `server_default`.

Table set (see `swarm-report/friend-chat-plan.md` §3):

* `Conversation` — one row per ORDERED pair `(user_low_id, user_high_id)`,
  same pair-ordering trick as `Friendship` (`app.services.friends.pair_key`).
  `last_seq` is the message-numbering counter, bumped inside the SAME
  transaction that inserts a `ChatMessage` (`UPDATE ... RETURNING last_seq`,
  see `app.services.chat.send_message`) — a plain `BIGSERIAL` on
  `ChatMessage.seq` would let two concurrent inserts commit in the opposite
  order their numbers were handed out, and a poll reading `seq > cursor`
  would silently skip one.
* `ChatMessage` — `body IS NULL` means "deleted by its author" (the row
  stays for numbering; nothing is retained). `notify_after`/`notify_state`/
  `notify_resolved_at` are Этап B's email-throttle plumbing — the COLUMNS
  ship now (cheap, and Stage B needs them on day one) but nothing in this
  stage ever reads or writes `notify_state` except `'pending'` (its
  default) and the one place a friendship is removed
  (`app.services.friends.remove_friend` -> `'unfriended'`, see that
  module). `kind` (friends-hub plan, Этап B) distinguishes an ordinary
  `'text'` message from an `'invite'` one — a duel invitation rendered as a
  chat bubble instead of raw text. An `'invite'` row always has `body IS
  NULL` and is created with `notify_state='undeliverable'` from the start
  (friends-hub plan MED: an invite must NEVER be picked up by
  `app.jobs.chat_notify`'s sweep — that job only ever looks at
  `notify_state = 'pending'`, so a terminal state set at INSERT time keeps
  it out unconditionally, no special-case needed in the sweep itself). Its
  one-to-one `invite` relationship points at `app.models.duel_invite.
  DuelInvite`, the source of truth for the invite's lifecycle state — see
  that model's docstring.
* `ChatRead` — a per-`(conversation, user)` CURSOR (`last_read_seq`), not a
  per-message read receipt: "opened the conversation" is one UPSERT, not N
  updates. Unread count = `COUNT(*) WHERE sender_id <> me AND seq >
  last_read_seq`.
* `UserPresence` — one row per user, `last_seen_at` updated (throttled to
  `CHAT_PRESENCE_WRITE_INTERVAL`) by the poll endpoint. Deliberately a
  narrow standalone table (see plan §3): writing this every ~30s directly
  onto `user` would drag MVCC churn through the row every login/auth check
  depends on.
* `ChatBlock` — `(blocker_id, blocked_id)`. `app.routers.chat`'s block
  endpoint always pairs an insert here with `friends_service.remove_friend`
  — "blocked but still friends" is a state nobody should be able to
  observe.
"""

import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from fastapi_users_db_sqlalchemy.generics import GUID
from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    String,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base

if TYPE_CHECKING:
    from app.models.duel_invite import DuelInvite
    from app.models.user import User

# App-level enum, validated in the app layer AND by the DB CHECK below, NOT a
# DB enum type — mirrors FRIENDSHIP_STATUSES / DUEL_ROOM_STATUSES.
CHAT_NOTIFY_STATES = (
    "pending",
    "sent",
    "seen",
    "read",
    "throttled_expired",
    "unsubscribed",
    "unfriended",
    "blocked",
    "undeliverable",
)

# friends-hub plan, Этап B — see ChatMessage.kind's docstring.
CHAT_MESSAGE_KINDS = ("text", "invite")


class Conversation(Base):
    """One row per unordered friend pair with at least one message
    exchanged. `pair_key` ordering + `begin_nested()`/`IntegrityError`
    get-or-create — see `app.services.chat.get_or_create_conversation`,
    identical shape to `app.services.friends.send_request`.
    """

    __tablename__ = "conversations"
    __table_args__ = (
        UniqueConstraint("user_low_id", "user_high_id", name="uq_conversations_pair"),
        CheckConstraint("user_low_id < user_high_id", name="ck_conversations_ordered_pair"),
        Index("ix_conversations_low", "user_low_id", "last_message_at"),
        Index("ix_conversations_high", "user_high_id", "last_message_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(GUID, primary_key=True, default=uuid.uuid4)
    user_low_id: Mapped[uuid.UUID] = mapped_column(GUID, ForeignKey("user.id", ondelete="CASCADE"))
    user_high_id: Mapped[uuid.UUID] = mapped_column(GUID, ForeignKey("user.id", ondelete="CASCADE"))
    last_seq: Mapped[int] = mapped_column(BigInteger, default=0, server_default="0")
    last_message_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    user_low: Mapped["User"] = relationship("User", foreign_keys=[user_low_id])
    user_high: Mapped["User"] = relationship("User", foreign_keys=[user_high_id])


class ChatMessage(Base):
    """One message. `seq` is 1-based and gapless within its conversation —
    see the module docstring for why it is NOT a `BIGSERIAL`.
    """

    __tablename__ = "chat_messages"
    __table_args__ = (
        UniqueConstraint("conversation_id", "seq", name="uq_chat_messages_conv_seq"),
        CheckConstraint(
            "notify_state IN ('pending','sent','seen','read','throttled_expired',"
            "'unsubscribed','unfriended','blocked','undeliverable')",
            name="ck_chat_messages_notify_state",
        ),
        CheckConstraint("kind IN ('text','invite')", name="ck_chat_messages_kind"),
        Index("ix_chat_messages_unread", "conversation_id", "sender_id", "seq"),
        Index("ix_chat_messages_sender_created", "sender_id", "created_at"),
        # Partial index — see plan §3: without `WHERE`, this index grows with
        # the whole message history; with it, it stays the size of the
        # currently-unresolved backlog (almost always ~empty).
        Index(
            "ix_chat_messages_notify",
            "notify_after",
            postgresql_where=text("notify_state = 'pending'"),
            sqlite_where=text("notify_state = 'pending'"),
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(GUID, primary_key=True, default=uuid.uuid4)
    conversation_id: Mapped[uuid.UUID] = mapped_column(
        GUID, ForeignKey("conversations.id", ondelete="CASCADE")
    )
    sender_id: Mapped[uuid.UUID] = mapped_column(GUID, ForeignKey("user.id", ondelete="CASCADE"))
    seq: Mapped[int] = mapped_column(BigInteger)
    body: Mapped[str | None] = mapped_column(String(length=2000), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # Этап B fields — populated from day one, unused (beyond 'pending'/
    # 'unfriended') until the sweep job in Этап B ships.
    notify_after: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    notify_state: Mapped[str] = mapped_column(
        String(length=16), default="pending", server_default="pending"
    )
    notify_resolved_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    # friends-hub plan, Этап B — see class docstring.
    kind: Mapped[str] = mapped_column(String(length=16), default="text", server_default="text")

    sender: Mapped["User"] = relationship("User", foreign_keys=[sender_id])
    # One-to-one, populated ONLY for `kind == "invite"` rows — always
    # eager-loaded (`selectinload`) by every read path that serializes a
    # message, never lazily (async SQLAlchemy forbids it). See
    # `app.models.duel_invite.DuelInvite`.
    invite: Mapped["DuelInvite | None"] = relationship(
        "DuelInvite", back_populates="message", uselist=False
    )


class ChatRead(Base):
    """Per-`(conversation, user)` read cursor. See module docstring."""

    __tablename__ = "chat_reads"

    conversation_id: Mapped[uuid.UUID] = mapped_column(
        GUID, ForeignKey("conversations.id", ondelete="CASCADE"), primary_key=True
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        GUID, ForeignKey("user.id", ondelete="CASCADE"), primary_key=True
    )
    last_read_seq: Mapped[int] = mapped_column(BigInteger, default=0, server_default="0")
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class UserPresence(Base):
    """One row per user; `last_seen_at` is bumped (throttled to
    `CHAT_PRESENCE_WRITE_INTERVAL`) by `GET /chat/poll` and NOTHING else in
    Этап A. See module docstring for why this is not a column on `user`.
    """

    __tablename__ = "user_presence"

    user_id: Mapped[uuid.UUID] = mapped_column(
        GUID, ForeignKey("user.id", ondelete="CASCADE"), primary_key=True
    )
    last_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class ChatBlock(Base):
    """`blocker_id` blocked `blocked_id`. Always inserted together with
    `friends_service.remove_friend` by `app.routers.chat`'s block endpoint —
    see module docstring.
    """

    __tablename__ = "chat_blocks"
    __table_args__ = (CheckConstraint("blocker_id <> blocked_id", name="ck_chat_blocks_not_self"),)

    blocker_id: Mapped[uuid.UUID] = mapped_column(
        GUID, ForeignKey("user.id", ondelete="CASCADE"), primary_key=True
    )
    blocked_id: Mapped[uuid.UUID] = mapped_column(
        GUID, ForeignKey("user.id", ondelete="CASCADE"), primary_key=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class EmailPrefs(Base):
    """Chat-email opt-out — Этап B. Lazily created: NO row for a user means
    "enabled" (see `app.services.chat_notify.NotifyContext.
    recipient_chat_email_enabled`, N6). `token_version` invalidates every
    unsubscribe link signed against an older version — see
    `app.services.unsubscribe_token`: unsubscribing *or* re-subscribing
    bumps it, so a stale link (e.g. from an already-actioned or archived
    email) can never flip the opposite of what its holder currently sees in
    their inbox.
    """

    __tablename__ = "email_prefs"

    user_id: Mapped[uuid.UUID] = mapped_column(
        GUID, ForeignKey("user.id", ondelete="CASCADE"), primary_key=True
    )
    chat_email_enabled: Mapped[bool] = mapped_column(default=True, server_default=text("true"))
    unsubscribed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    token_version: Mapped[int] = mapped_column(default=1, server_default="1")


class ChatEmailState(Base):
    """Hourly-throttle + daily-cap bookkeeping for ONE `(conversation,
    recipient)` pair — Этап B (plan §3, "chat_email_state — часовой
    троттл"). Deliberately keyed per conversation, not globally per
    recipient: two different friends messaging the same evening are two
    separate emails (plan §3).

    `emails_sent` counts sends for the CURRENT calendar day only — the
    sweep job (`app.jobs.chat_notify`) resets it to 0 the first time it
    writes to this row on a new UTC day (tracked via `last_email_at`'s
    date), rather than adding a separate `emails_sent_date` column: the
    invariant "count belongs to the day of the last send" is exactly what
    `last_email_at` already encodes.
    """

    __tablename__ = "chat_email_state"

    conversation_id: Mapped[uuid.UUID] = mapped_column(
        GUID, ForeignKey("conversations.id", ondelete="CASCADE"), primary_key=True
    )
    recipient_id: Mapped[uuid.UUID] = mapped_column(
        GUID, ForeignKey("user.id", ondelete="CASCADE"), primary_key=True
    )
    last_email_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    emails_sent: Mapped[int] = mapped_column(default=0, server_default="0")
