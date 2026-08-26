"""duel invites in chat — friends-hub plan, Этап B

Revision ID: 0018_duel_invites
Revises: 0017_avatar_text
Create Date: 2026-08-26

HAND-WRITTEN (mirrors 0015_chat/0016_chat_email's style; Docker/Postgres
unavailable to `alembic revision --autogenerate` at authoring time). Mirrors
``app.models.chat`` (`ChatMessage.kind`) and ``app.models.duel_invite``
(``DuelInvite``).

Two changes:
* `chat_messages.kind` — a new NOT NULL column with a `'text'` server
  default, so every existing row (and every write done by an
  as-yet-unmigrated worker mid-deploy) is valid without a backfill pass.
* `duel_invites` — one brand-new table, FK'd to `chat_messages` (CASCADE —
  chat messages are never hard-deleted, only soft `body=NULL`'d, so this
  never actually fires in practice, but the constraint documents the
  relationship), `user` (CASCADE, twice — see below), and `duel_rooms`
  (SET NULL — a room outlives the invite that spawned it).

Cascade-delete note: `inviter_id`/`invitee_id` both `ON DELETE CASCADE` —
deleting a user must not leave an orphaned `duel_invites` row referencing
them (plan requirement: "каскад удаления user не должен оставлять сирот в
duel_invites").

Purely additive plus one new nullable-free column with a default — safe on
both an empty AND an already-populated database.

Verify with `alembic upgrade head` / `downgrade -1` / `upgrade head` against
Postgres before deploy.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "0018_duel_invites"
down_revision: str | None = "0017_avatar_text"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "chat_messages",
        sa.Column("kind", sa.String(length=16), server_default="text", nullable=False),
    )
    op.create_check_constraint(
        "ck_chat_messages_kind", "chat_messages", "kind IN ('text','invite')"
    )

    op.create_table(
        "duel_invites",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("message_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("inviter_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("invitee_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("state", sa.String(length=16), server_default="pending", nullable=False),
        sa.Column("room_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("message_id", name="uq_duel_invites_message_id"),
        sa.CheckConstraint(
            "state IN ('pending','accepted','declined','canceled','expired')",
            name="ck_duel_invites_state",
        ),
    )
    op.create_index("ix_duel_invites_inviter_id", "duel_invites", ["inviter_id"])
    op.create_index("ix_duel_invites_invitee_id", "duel_invites", ["invitee_id"])
    op.create_foreign_key(
        "fk_duel_invites_message_id_chat_messages",
        "duel_invites",
        "chat_messages",
        ["message_id"],
        ["id"],
        ondelete="CASCADE",
    )
    op.create_foreign_key(
        "fk_duel_invites_inviter_id_user",
        "duel_invites",
        "user",
        ["inviter_id"],
        ["id"],
        ondelete="CASCADE",
    )
    op.create_foreign_key(
        "fk_duel_invites_invitee_id_user",
        "duel_invites",
        "user",
        ["invitee_id"],
        ["id"],
        ondelete="CASCADE",
    )
    op.create_foreign_key(
        "fk_duel_invites_room_id_duel_rooms",
        "duel_invites",
        "duel_rooms",
        ["room_id"],
        ["id"],
        ondelete="SET NULL",
    )


def downgrade() -> None:
    op.drop_constraint("fk_duel_invites_room_id_duel_rooms", "duel_invites", type_="foreignkey")
    op.drop_constraint("fk_duel_invites_invitee_id_user", "duel_invites", type_="foreignkey")
    op.drop_constraint("fk_duel_invites_inviter_id_user", "duel_invites", type_="foreignkey")
    op.drop_constraint(
        "fk_duel_invites_message_id_chat_messages", "duel_invites", type_="foreignkey"
    )
    op.drop_index("ix_duel_invites_invitee_id", table_name="duel_invites")
    op.drop_index("ix_duel_invites_inviter_id", table_name="duel_invites")
    op.drop_table("duel_invites")

    op.drop_constraint("ck_chat_messages_kind", "chat_messages", type_="check")
    op.drop_column("chat_messages", "kind")
