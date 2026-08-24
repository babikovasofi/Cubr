"""cups_events table — award ledger for the duel cups ladder (plan: cups-award)

Revision ID: 0014_cups_events
Revises: 0013
Create Date: 2026-08-24

HAND-WRITTEN (mirrors 0008_user_badges' style; Docker/Postgres unavailable to
`alembic revision --autogenerate` at authoring time). Mirrors
``app.models.cups_event.CupsEvent``.

A brand-new, purely-additive table — no column touches ``user`` or
``duel_rooms`` (``User.cups`` already exists, added long ago and simply
unused until now). Safe on both an empty AND an already-populated database:
``CREATE TABLE`` + two FKs + one UNIQUE + three plain indexes never lock or
rewrite any existing row on ``user``/``duel_rooms``, and every existing duel
room stays exactly as it is — this migration awards nothing retroactively,
only new finalizes go through ``app.services.cups`` from here on.

``UNIQUE(room_id, user_id)`` is the idempotency guarantee behind
``app.services.cups.award_for_finished_room``'s ``begin_nested()`` +
``IntegrityError`` pattern — see that module's docstring.

PLACEHOLDER down_revision ("0013"): another branch owns 0013 and merges
ahead of this one, but its revision id is not visible in this worktree.
This migration was verified end-to-end against a real Postgres by
temporarily chaining it onto 0012_onboarded_at (this worktree's actual
head) — same op.* calls either way, only the parent id changes. Whoever
merges after 0013 lands must confirm `down_revision` here matches that
revision's real id (already `"0013"` if its filename stem is literally
that) and rerun `alembic upgrade head` once both are in the same tree.

Verify with `alembic upgrade head` against Postgres before deploy.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "0014_cups_events"
down_revision: str | None = "0013_single_user_handle"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "cups_events",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("room_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("opponent_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("delta", sa.Integer(), nullable=False),
        sa.Column("reason", sa.String(length=32), nullable=False),
        sa.Column("farm_limited", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column("cups_before", sa.Integer(), nullable=False),
        sa.Column("cups_after", sa.Integer(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_cups_events_room_id"), "cups_events", ["room_id"])
    op.create_index(op.f("ix_cups_events_user_id"), "cups_events", ["user_id"])
    op.create_index(op.f("ix_cups_events_opponent_id"), "cups_events", ["opponent_id"])
    op.create_foreign_key(
        "fk_cups_events_room_id_duel_rooms",
        "cups_events",
        "duel_rooms",
        ["room_id"],
        ["id"],
        ondelete="CASCADE",
    )
    op.create_foreign_key(
        "fk_cups_events_user_id_user",
        "cups_events",
        "user",
        ["user_id"],
        ["id"],
        ondelete="CASCADE",
    )
    op.create_foreign_key(
        "fk_cups_events_opponent_id_user",
        "cups_events",
        "user",
        ["opponent_id"],
        ["id"],
        ondelete="CASCADE",
    )
    op.create_unique_constraint("uq_cups_events_room_user", "cups_events", ["room_id", "user_id"])


def downgrade() -> None:
    op.drop_constraint("uq_cups_events_room_user", "cups_events", type_="unique")
    op.drop_constraint("fk_cups_events_opponent_id_user", "cups_events", type_="foreignkey")
    op.drop_constraint("fk_cups_events_user_id_user", "cups_events", type_="foreignkey")
    op.drop_constraint("fk_cups_events_room_id_duel_rooms", "cups_events", type_="foreignkey")
    op.drop_index(op.f("ix_cups_events_opponent_id"), table_name="cups_events")
    op.drop_index(op.f("ix_cups_events_user_id"), table_name="cups_events")
    op.drop_index(op.f("ix_cups_events_room_id"), table_name="cups_events")
    op.drop_table("cups_events")
