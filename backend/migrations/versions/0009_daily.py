"""daily_challenges + daily_attempts tables

Revision ID: 0009_daily
Revises: 0008_user_badges
Create Date: 2026-07-19

HAND-WRITTEN (Docker/Postgres unavailable to `alembic revision --autogenerate`
at authoring time). Mirrors ``app.models.daily.DailyChallenge`` and
``app.models.daily.DailyAttempt`` — a PARALLEL vertical to
``0005_tournaments``, structurally identical except the sharding key is a
single UTC ``date`` column instead of ``(iso_year, iso_week)``.
``daily_challenges`` carries a UNIQUE (date) — one shared scramble per UTC
day, created lazily by the first ``POST /daily/current/attempt/start`` of the
day. ``daily_attempts`` carries a UNIQUE (user_id, daily_id) — one attempt
per user per day — and FKs CASCADE on both `user_id` and `daily_id` (an
attempt has no meaning once its user or daily challenge is gone).

This migration does NOT touch `tournaments` / `tournament_attempts` /
`solves` — those are byte-for-byte untouched (Decision B: parallel tables,
not a generalized `period` dimension).

Verify with `alembic upgrade head` against Postgres before deploy.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "0009_daily"
down_revision: str | None = "0008_user_badges"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "daily_challenges",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("date", sa.Date(), nullable=False),
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
    op.create_unique_constraint("uq_daily_challenges_date", "daily_challenges", ["date"])

    op.create_table(
        "daily_attempts",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("daily_id", postgresql.UUID(as_uuid=True), nullable=False),
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
    op.create_index(op.f("ix_daily_attempts_user_id"), "daily_attempts", ["user_id"], unique=False)
    op.create_index(
        op.f("ix_daily_attempts_daily_id"), "daily_attempts", ["daily_id"], unique=False
    )
    op.create_foreign_key(
        "fk_daily_attempts_user_id_user",
        "daily_attempts",
        "user",
        ["user_id"],
        ["id"],
        ondelete="CASCADE",
    )
    op.create_foreign_key(
        "fk_daily_attempts_daily_id_daily_challenges",
        "daily_attempts",
        "daily_challenges",
        ["daily_id"],
        ["id"],
        ondelete="CASCADE",
    )
    op.create_unique_constraint(
        "uq_daily_attempts_user_daily",
        "daily_attempts",
        ["user_id", "daily_id"],
    )


def downgrade() -> None:
    op.drop_constraint("uq_daily_attempts_user_daily", "daily_attempts", type_="unique")
    op.drop_constraint(
        "fk_daily_attempts_daily_id_daily_challenges",
        "daily_attempts",
        type_="foreignkey",
    )
    op.drop_constraint("fk_daily_attempts_user_id_user", "daily_attempts", type_="foreignkey")
    op.drop_index(op.f("ix_daily_attempts_daily_id"), table_name="daily_attempts")
    op.drop_index(op.f("ix_daily_attempts_user_id"), table_name="daily_attempts")
    op.drop_table("daily_attempts")
    op.drop_constraint("uq_daily_challenges_date", "daily_challenges", type_="unique")
    op.drop_table("daily_challenges")
