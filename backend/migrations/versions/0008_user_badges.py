"""user_badges table

Revision ID: 0008_user_badges
Revises: 0007_duel_rooms
Create Date: 2026-07-19

HAND-WRITTEN (mirrors 0007_duel_rooms' style; Docker/Postgres unavailable to
`alembic revision --autogenerate` at authoring time). Mirrors
``app.models.user_badge.UserBadge``.

``UNIQUE(user_id, code)`` (full, no partial/`sqlite_where` needed) is the
idempotency guarantee behind ``app.services.badges.grant``'s
``begin_nested()`` + ``IntegrityError`` pattern.

This is a SEPARATE brick from `solves`: no FK/touch to `solves` here at all
(§П5 PB-invariant frozen — badges never link to that table).

Verify with `alembic upgrade head` against Postgres before deploy.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "0008_user_badges"
down_revision: str | None = "0007_duel_rooms"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "user_badges",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("code", sa.String(length=64), nullable=False),
        sa.Column(
            "earned_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_user_badges_user_id"), "user_badges", ["user_id"])
    op.create_foreign_key(
        "fk_user_badges_user_id_user",
        "user_badges",
        "user",
        ["user_id"],
        ["id"],
        ondelete="CASCADE",
    )
    op.create_unique_constraint(
        "uq_user_badges_user_code", "user_badges", ["user_id", "code"]
    )


def downgrade() -> None:
    op.drop_constraint("uq_user_badges_user_code", "user_badges", type_="unique")
    op.drop_constraint("fk_user_badges_user_id_user", "user_badges", type_="foreignkey")
    op.drop_index(op.f("ix_user_badges_user_id"), table_name="user_badges")
    op.drop_table("user_badges")
