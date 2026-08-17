"""duel_rooms + duel_participants tables

Revision ID: 0007_duel_rooms
Revises: 0006_user_public_handle
Create Date: 2026-07-18

HAND-WRITTEN (mirrors 0005_tournaments' style; Docker/Postgres unavailable to
`alembic revision --autogenerate` at authoring time). Mirrors
``app.models.duel.DuelRoom`` and ``app.models.duel_participant.DuelParticipant``.

``duel_participants`` carries a **partial UNIQUE index on `user_id` WHERE
`active`** — this, not a two-column check on `duel_rooms`, is what physically
enforces П11 ("one active duel per user"); see the model docstrings for why
a two-column `DuelRoom` check can't be raced safely with
`session.begin_nested()`.

``duel_rooms.parent_room_id`` carries a UNIQUE constraint — the rematch
get-or-create (`app.services.duel.rematch`) relies on it to guarantee exactly
one child room per parent even under a double-click race by both players.

This is a SEPARATE brick from `solves`: `solves.duel_id` stays a plain
nullable UUID column with NO FK to `duel_rooms` (§П5 PB-invariant frozen —
this brick deliberately never writes to `solves`).

Verify with `alembic upgrade head` against Postgres before deploy.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "0007_duel_rooms"
down_revision: str | None = "0006_user_public_handle"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "duel_rooms",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("invite_token", sa.String(length=64), nullable=False),
        sa.Column("mode", sa.String(length=16), server_default="fast", nullable=False),
        sa.Column("event", sa.String(length=16), server_default="333", nullable=False),
        sa.Column("status", sa.String(length=16), server_default="open", nullable=False),
        sa.Column("scramble", sa.String(length=512), nullable=True),
        sa.Column("player_a_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("player_b_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("a_time_ms", sa.Integer(), nullable=True),
        sa.Column("b_time_ms", sa.Integer(), nullable=True),
        sa.Column("a_status", sa.String(length=16), server_default="pending", nullable=False),
        sa.Column("b_status", sa.String(length=16), server_default="pending", nullable=False),
        sa.Column("a_verify_frames_ok", sa.Boolean(), nullable=True),
        sa.Column("b_verify_frames_ok", sa.Boolean(), nullable=True),
        sa.Column("a_honesty", sa.String(length=16), server_default="pending", nullable=False),
        sa.Column("b_honesty", sa.String(length=16), server_default="pending", nullable=False),
        sa.Column("a_finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("b_finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("winner_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("parent_room_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_unique_constraint("uq_duel_rooms_invite_token", "duel_rooms", ["invite_token"])
    op.create_index(op.f("ix_duel_rooms_invite_token"), "duel_rooms", ["invite_token"])
    op.create_index(op.f("ix_duel_rooms_status"), "duel_rooms", ["status"])
    op.create_index(op.f("ix_duel_rooms_player_a_id"), "duel_rooms", ["player_a_id"])
    op.create_index(op.f("ix_duel_rooms_player_b_id"), "duel_rooms", ["player_b_id"])
    op.create_index(op.f("ix_duel_rooms_parent_room_id"), "duel_rooms", ["parent_room_id"])
    op.create_foreign_key(
        "fk_duel_rooms_player_a_id_user",
        "duel_rooms",
        "user",
        ["player_a_id"],
        ["id"],
        ondelete="CASCADE",
    )
    op.create_foreign_key(
        "fk_duel_rooms_player_b_id_user",
        "duel_rooms",
        "user",
        ["player_b_id"],
        ["id"],
        ondelete="CASCADE",
    )
    op.create_foreign_key(
        "fk_duel_rooms_parent_room_id_duel_rooms",
        "duel_rooms",
        "duel_rooms",
        ["parent_room_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_unique_constraint("uq_duel_rooms_parent_room_id", "duel_rooms", ["parent_room_id"])

    op.create_table(
        "duel_participants",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("room_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("active", sa.Boolean(), server_default="true", nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_duel_participants_user_id"), "duel_participants", ["user_id"])
    op.create_index(op.f("ix_duel_participants_room_id"), "duel_participants", ["room_id"])
    op.create_foreign_key(
        "fk_duel_participants_user_id_user",
        "duel_participants",
        "user",
        ["user_id"],
        ["id"],
        ondelete="CASCADE",
    )
    op.create_foreign_key(
        "fk_duel_participants_room_id_duel_rooms",
        "duel_participants",
        "duel_rooms",
        ["room_id"],
        ["id"],
        ondelete="CASCADE",
    )
    # Partial UNIQUE index — the physical П11 enforcement (see module docstring).
    op.create_index(
        "uq_duel_participants_user_active",
        "duel_participants",
        ["user_id"],
        unique=True,
        postgresql_where=sa.text("active"),
    )


def downgrade() -> None:
    op.drop_index("uq_duel_participants_user_active", table_name="duel_participants")
    op.drop_constraint(
        "fk_duel_participants_room_id_duel_rooms", "duel_participants", type_="foreignkey"
    )
    op.drop_constraint("fk_duel_participants_user_id_user", "duel_participants", type_="foreignkey")
    op.drop_index(op.f("ix_duel_participants_room_id"), table_name="duel_participants")
    op.drop_index(op.f("ix_duel_participants_user_id"), table_name="duel_participants")
    op.drop_table("duel_participants")

    op.drop_constraint("uq_duel_rooms_parent_room_id", "duel_rooms", type_="unique")
    op.drop_constraint("fk_duel_rooms_parent_room_id_duel_rooms", "duel_rooms", type_="foreignkey")
    op.drop_constraint("fk_duel_rooms_player_b_id_user", "duel_rooms", type_="foreignkey")
    op.drop_constraint("fk_duel_rooms_player_a_id_user", "duel_rooms", type_="foreignkey")
    op.drop_index(op.f("ix_duel_rooms_parent_room_id"), table_name="duel_rooms")
    op.drop_index(op.f("ix_duel_rooms_player_b_id"), table_name="duel_rooms")
    op.drop_index(op.f("ix_duel_rooms_player_a_id"), table_name="duel_rooms")
    op.drop_index(op.f("ix_duel_rooms_status"), table_name="duel_rooms")
    op.drop_index(op.f("ix_duel_rooms_invite_token"), table_name="duel_rooms")
    op.drop_constraint("uq_duel_rooms_invite_token", "duel_rooms", type_="unique")
    op.drop_table("duel_rooms")
