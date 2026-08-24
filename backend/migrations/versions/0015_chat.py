"""chat tables — Этап A of the friend-chat plan (переписка, без единого письма)

Revision ID: 0015_chat
Revises: 0014_cups_events
Create Date: 2026-08-24

HAND-WRITTEN (mirrors 0011_friendships' style; Docker/Postgres unavailable to
`alembic revision --autogenerate` at authoring time). Mirrors
``app.models.chat`` (``Conversation``, ``ChatMessage``, ``ChatRead``,
``UserPresence``, ``ChatBlock``).

Purely additive — five brand-new tables, no column touches ``user`` or any
existing table. Safe on both an empty AND an already-populated database.

``ix_chat_messages_notify`` is a PARTIAL index (``WHERE notify_state =
'pending'``) — see ``app.models.chat``'s module docstring for why: without
the predicate it would grow with the entire message history; with it, it
stays the size of the currently-unresolved backlog. Этап A never writes
anything but ``'pending'``/``'unfriended'`` into ``notify_state`` (the
sweep job that reads this index ships in Этап B), so the index stays tiny
from day one regardless.

Verify with `alembic upgrade head` against Postgres before deploy.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "0015_chat"
down_revision: str | None = "0014_cups_events"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "conversations",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("user_low_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("user_high_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("last_seq", sa.BigInteger(), server_default="0", nullable=False),
        sa.Column("last_message_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_low_id", "user_high_id", name="uq_conversations_pair"),
        sa.CheckConstraint("user_low_id < user_high_id", name="ck_conversations_ordered_pair"),
    )
    op.create_index("ix_conversations_low", "conversations", ["user_low_id", "last_message_at"])
    op.create_index("ix_conversations_high", "conversations", ["user_high_id", "last_message_at"])
    op.create_foreign_key(
        "fk_conversations_user_low_id_user",
        "conversations",
        "user",
        ["user_low_id"],
        ["id"],
        ondelete="CASCADE",
    )
    op.create_foreign_key(
        "fk_conversations_user_high_id_user",
        "conversations",
        "user",
        ["user_high_id"],
        ["id"],
        ondelete="CASCADE",
    )

    op.create_table(
        "chat_messages",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("conversation_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("sender_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("seq", sa.BigInteger(), nullable=False),
        sa.Column("body", sa.String(length=2000), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("notify_after", sa.DateTime(timezone=True), nullable=False),
        sa.Column("notify_state", sa.String(length=16), server_default="pending", nullable=False),
        sa.Column("notify_resolved_at", sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("conversation_id", "seq", name="uq_chat_messages_conv_seq"),
        sa.CheckConstraint(
            "notify_state IN ('pending','sent','seen','read','throttled_expired',"
            "'unsubscribed','unfriended','blocked','undeliverable')",
            name="ck_chat_messages_notify_state",
        ),
    )
    op.create_index(
        "ix_chat_messages_unread", "chat_messages", ["conversation_id", "sender_id", "seq"]
    )
    op.create_index("ix_chat_messages_sender_created", "chat_messages", ["sender_id", "created_at"])
    op.create_index(
        "ix_chat_messages_notify",
        "chat_messages",
        ["notify_after"],
        postgresql_where=sa.text("notify_state = 'pending'"),
    )
    op.create_foreign_key(
        "fk_chat_messages_conversation_id_conversations",
        "chat_messages",
        "conversations",
        ["conversation_id"],
        ["id"],
        ondelete="CASCADE",
    )
    op.create_foreign_key(
        "fk_chat_messages_sender_id_user",
        "chat_messages",
        "user",
        ["sender_id"],
        ["id"],
        ondelete="CASCADE",
    )

    op.create_table(
        "chat_reads",
        sa.Column("conversation_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("last_read_seq", sa.BigInteger(), server_default="0", nullable=False),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("conversation_id", "user_id"),
    )
    op.create_foreign_key(
        "fk_chat_reads_conversation_id_conversations",
        "chat_reads",
        "conversations",
        ["conversation_id"],
        ["id"],
        ondelete="CASCADE",
    )
    op.create_foreign_key(
        "fk_chat_reads_user_id_user", "chat_reads", "user", ["user_id"], ["id"], ondelete="CASCADE"
    )

    op.create_table(
        "user_presence",
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("user_id"),
    )
    op.create_foreign_key(
        "fk_user_presence_user_id_user",
        "user_presence",
        "user",
        ["user_id"],
        ["id"],
        ondelete="CASCADE",
    )

    op.create_table(
        "chat_blocks",
        sa.Column("blocker_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("blocked_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("blocker_id", "blocked_id"),
        sa.CheckConstraint("blocker_id <> blocked_id", name="ck_chat_blocks_not_self"),
    )
    op.create_foreign_key(
        "fk_chat_blocks_blocker_id_user",
        "chat_blocks",
        "user",
        ["blocker_id"],
        ["id"],
        ondelete="CASCADE",
    )
    op.create_foreign_key(
        "fk_chat_blocks_blocked_id_user",
        "chat_blocks",
        "user",
        ["blocked_id"],
        ["id"],
        ondelete="CASCADE",
    )


def downgrade() -> None:
    op.drop_constraint("fk_chat_blocks_blocked_id_user", "chat_blocks", type_="foreignkey")
    op.drop_constraint("fk_chat_blocks_blocker_id_user", "chat_blocks", type_="foreignkey")
    op.drop_table("chat_blocks")

    op.drop_constraint("fk_user_presence_user_id_user", "user_presence", type_="foreignkey")
    op.drop_table("user_presence")

    op.drop_constraint("fk_chat_reads_user_id_user", "chat_reads", type_="foreignkey")
    op.drop_constraint(
        "fk_chat_reads_conversation_id_conversations", "chat_reads", type_="foreignkey"
    )
    op.drop_table("chat_reads")

    op.drop_constraint("fk_chat_messages_sender_id_user", "chat_messages", type_="foreignkey")
    op.drop_constraint(
        "fk_chat_messages_conversation_id_conversations", "chat_messages", type_="foreignkey"
    )
    op.drop_index("ix_chat_messages_notify", table_name="chat_messages")
    op.drop_index("ix_chat_messages_sender_created", table_name="chat_messages")
    op.drop_index("ix_chat_messages_unread", table_name="chat_messages")
    op.drop_table("chat_messages")

    op.drop_constraint("fk_conversations_user_high_id_user", "conversations", type_="foreignkey")
    op.drop_constraint("fk_conversations_user_low_id_user", "conversations", type_="foreignkey")
    op.drop_index("ix_conversations_high", table_name="conversations")
    op.drop_index("ix_conversations_low", table_name="conversations")
    op.drop_table("conversations")
