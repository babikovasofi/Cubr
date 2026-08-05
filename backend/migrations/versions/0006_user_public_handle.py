"""add user.public_handle

Revision ID: 0006_user_public_handle
Revises: 0005_tournaments
Create Date: 2026-07-18

HAND-WRITTEN (mirrors 0005_tournaments' style). Adds a single nullable
``public_handle`` column to ``user`` — a deliberately-set, opt-in display
name for public surfaces (e.g. the weekly tournament standings board, see
``app.services.tournament.display_name_for``). NEVER derived from
email/nickname; unset renders as "Аноним" at the service layer, not via a DB
default.

Verify with `alembic upgrade head` against Postgres before deploy.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0006_user_public_handle"
down_revision: str | None = "0005_tournaments"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "user",
        sa.Column("public_handle", sa.String(length=64), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("user", "public_handle")
