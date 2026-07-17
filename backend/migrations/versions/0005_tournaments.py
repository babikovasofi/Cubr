"""tournaments + tournament_attempts tables

Revision ID: 0005_tournaments
Revises: 0004_scrambles
Create Date: 2026-07-17

HAND-WRITTEN (Docker/Postgres unavailable to `alembic revision --autogenerate`
at authoring time). Mirrors ``app.models.tournament.Tournament`` and
``app.models.tournament.TournamentAttempt``. ``tournaments`` carries a UNIQUE
(iso_year, iso_week) — one shared scramble per ISO week, created lazily by the
first ``POST /tournament/current/attempt/start`` of the week.
``tournament_attempts`` carries a UNIQUE (user_id, tournament_id) — one
attempt per user per week — and FKs CASCADE on both `user_id` and
`tournament_id` (an attempt has no meaning once its user or tournament is
gone; contrast with ``solves.cube_id``/``solves.scramble_id`` which are
SET NULL because a solve outlives the thing it referenced).

This is a SEPARATE brick from `solves`: ``solves.tournament_id`` stays a
plain nullable UUID column, untouched (the frozen best_single_ms PB
invariant is not to be disturbed by this migration).

Verify with `alembic upgrade head` against Postgres before deploy.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "0005_tournaments"
down_revision: str | None = "0004_scrambles"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "tournaments",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("iso_year", sa.Integer(), nullable=False),
        sa.Column("iso_week", sa.Integer(), nullable=False),
        sa.Column("event", sa.String(length=16), server_default="333", nullable=False),
        sa.Column("scramble", sa.String(length=512), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_unique_constraint("uq_tournaments_iso_week", "tournaments", ["iso_year", "iso_week"])

    op.create_table(
        "tournament_attempts",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("tournament_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("status", sa.String(length=16), server_default="started", nullable=False),
        sa.Column("honesty", sa.String(length=16), server_default="pending", nullable=False),
        sa.Column("time_ms", sa.Integer(), nullable=True),
        sa.Column(
            "started_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("submitted_at", sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_tournament_attempts_user_id"), "tournament_attempts", ["user_id"], unique=False
    )
    op.create_index(
        op.f("ix_tournament_attempts_tournament_id"),
        "tournament_attempts",
        ["tournament_id"],
        unique=False,
    )
    op.create_foreign_key(
        "fk_tournament_attempts_user_id_user",
        "tournament_attempts",
        "user",
        ["user_id"],
        ["id"],
        ondelete="CASCADE",
    )
    op.create_foreign_key(
        "fk_tournament_attempts_tournament_id_tournaments",
        "tournament_attempts",
        "tournaments",
        ["tournament_id"],
        ["id"],
        ondelete="CASCADE",
    )
    op.create_unique_constraint(
        "uq_tournament_attempts_user_tournament",
        "tournament_attempts",
        ["user_id", "tournament_id"],
    )


def downgrade() -> None:
    op.drop_constraint(
        "uq_tournament_attempts_user_tournament", "tournament_attempts", type_="unique"
    )
    op.drop_constraint(
        "fk_tournament_attempts_tournament_id_tournaments",
        "tournament_attempts",
        type_="foreignkey",
    )
    op.drop_constraint(
        "fk_tournament_attempts_user_id_user", "tournament_attempts", type_="foreignkey"
    )
    op.drop_index(op.f("ix_tournament_attempts_tournament_id"), table_name="tournament_attempts")
    op.drop_index(op.f("ix_tournament_attempts_user_id"), table_name="tournament_attempts")
    op.drop_table("tournament_attempts")
    op.drop_constraint("uq_tournaments_iso_week", "tournaments", type_="unique")
    op.drop_table("tournaments")
