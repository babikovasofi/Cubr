"""matchmaking queue — friends-hub plan, Этап C

Revision ID: 0019_matchmaking_queue
Revises: 0018_duel_invites
Create Date: 2026-08-26

HAND-WRITTEN (mirrors 0015_chat's style; Docker/Postgres unavailable to
`alembic revision --autogenerate` at authoring time). Mirrors
``app.models.matchmaking.MatchmakingQueue``.

One brand-new table, `user_id` itself the primary key (mirrors
`user_presence` — see that model's docstring for why: "at most one row per
user" needs no separate surrogate key). `room_id` is a nullable FK to
`duel_rooms`, `ON DELETE SET NULL` (a duel room outlives the queue row that
spawned it; the row itself is deleted by the app once consumed, not by this
FK). `ix_matchmaking_queue_waiting` is PARTIAL (`WHERE room_id IS NULL`) —
same "stays the size of the currently-active backlog" reasoning as
`ix_chat_messages_notify` (see `0015_chat`).

Purely additive — no column touches any existing table. Safe on both an
empty AND an already-populated database.

Verify with `alembic upgrade head` / `downgrade -1` / `upgrade head` against
Postgres before deploy.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "0019_matchmaking_queue"
down_revision: str | None = "0018_duel_invites"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "matchmaking_queue",
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("room_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("user_id"),
    )
    op.create_index(
        "ix_matchmaking_queue_waiting",
        "matchmaking_queue",
        ["created_at"],
        postgresql_where=sa.text("room_id IS NULL"),
    )
    op.create_foreign_key(
        "fk_matchmaking_queue_user_id_user",
        "matchmaking_queue",
        "user",
        ["user_id"],
        ["id"],
        ondelete="CASCADE",
    )
    op.create_foreign_key(
        "fk_matchmaking_queue_room_id_duel_rooms",
        "matchmaking_queue",
        "duel_rooms",
        ["room_id"],
        ["id"],
        ondelete="SET NULL",
    )


def downgrade() -> None:
    op.drop_constraint(
        "fk_matchmaking_queue_room_id_duel_rooms", "matchmaking_queue", type_="foreignkey"
    )
    op.drop_constraint("fk_matchmaking_queue_user_id_user", "matchmaking_queue", type_="foreignkey")
    op.drop_index("ix_matchmaking_queue_waiting", table_name="matchmaking_queue")
    op.drop_table("matchmaking_queue")
