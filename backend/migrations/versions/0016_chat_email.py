"""chat email tables — Этап B of the friend-chat plan (письма о новом сообщении)

Revision ID: 0016_chat_email
Revises: 0015_chat
Create Date: 2026-08-24

HAND-WRITTEN (mirrors 0015_chat's style; Docker/Postgres unavailable to
`alembic revision --autogenerate` at authoring time). Mirrors
``app.models.chat`` (``EmailPrefs``, ``ChatEmailState``).

Purely additive — two brand-new tables, no column touches ``user`` or any
existing table. Safe on both an empty AND an already-populated database.

Verify with `alembic upgrade head` / `downgrade -1` / `upgrade head` against
Postgres before deploy.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "0016_chat_email"
down_revision: str | None = "0015_chat"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "email_prefs",
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column(
            "chat_email_enabled", sa.Boolean(), server_default=sa.text("true"), nullable=False
        ),
        sa.Column("unsubscribed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("token_version", sa.Integer(), server_default="1", nullable=False),
        sa.PrimaryKeyConstraint("user_id"),
    )
    op.create_foreign_key(
        "fk_email_prefs_user_id_user",
        "email_prefs",
        "user",
        ["user_id"],
        ["id"],
        ondelete="CASCADE",
    )

    op.create_table(
        "chat_email_state",
        sa.Column("conversation_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("recipient_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("last_email_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("emails_sent", sa.Integer(), server_default="0", nullable=False),
        sa.PrimaryKeyConstraint("conversation_id", "recipient_id"),
    )
    op.create_foreign_key(
        "fk_chat_email_state_conversation_id_conversations",
        "chat_email_state",
        "conversations",
        ["conversation_id"],
        ["id"],
        ondelete="CASCADE",
    )
    op.create_foreign_key(
        "fk_chat_email_state_recipient_id_user",
        "chat_email_state",
        "user",
        ["recipient_id"],
        ["id"],
        ondelete="CASCADE",
    )


def downgrade() -> None:
    op.drop_constraint(
        "fk_chat_email_state_recipient_id_user", "chat_email_state", type_="foreignkey"
    )
    op.drop_constraint(
        "fk_chat_email_state_conversation_id_conversations",
        "chat_email_state",
        type_="foreignkey",
    )
    op.drop_table("chat_email_state")

    op.drop_constraint("fk_email_prefs_user_id_user", "email_prefs", type_="foreignkey")
    op.drop_table("email_prefs")
