"""init: user + solves

Revision ID: 0001_init
Revises:
Create Date: 2026-07-10

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "0001_init"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "user",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("email", sa.String(length=320), nullable=False),
        sa.Column("hashed_password", sa.String(length=1024), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False),
        sa.Column("is_superuser", sa.Boolean(), nullable=False),
        sa.Column("is_verified", sa.Boolean(), nullable=False),
        sa.Column("nickname", sa.String(length=64), nullable=False),
        sa.Column("avatar_url", sa.String(length=512), nullable=True),
        sa.Column("cups", sa.Integer(), server_default="0", nullable=False),
        sa.Column("best_single_ms", sa.Integer(), nullable=True),
        sa.Column("best_ao5_ms", sa.Integer(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_user_email"), "user", ["email"], unique=True)

    op.create_table(
        "solves",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        # duel_id / tournament_id: plain nullable UUID columns, NO ForeignKey —
        # duels/tournaments tables do not exist yet (FKs come in 3.x/5.x).
        sa.Column("duel_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("tournament_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("scramble", sa.String(length=512), nullable=False),
        sa.Column("time_ms", sa.Integer(), nullable=False),
        # status: VARCHAR + app-level validation (valid|dnf|rejected), NOT a DB enum.
        sa.Column("status", sa.String(length=16), server_default="valid", nullable=False),
        sa.Column("verify_frames_ok", sa.Boolean(), server_default="false", nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["user_id"], ["user.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_solves_user_id"), "solves", ["user_id"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_solves_user_id"), table_name="solves")
    op.drop_table("solves")
    op.drop_index(op.f("ix_user_email"), table_name="user")
    op.drop_table("user")
