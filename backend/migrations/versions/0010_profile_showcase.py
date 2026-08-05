"""user.method + user.cubing_since_year (profile showcase, V3)

Revision ID: 0010_profile_showcase
Revises: 0009_daily
Create Date: 2026-07-28

HAND-WRITTEN (Docker/Postgres unavailable to `alembic revision --autogenerate`
at authoring time). Two nullable columns on `user`, nothing else: the profile
showcase (which method a person solves with, and since when). Both are
owner-visible only — Cubr has no public profile page, and the standings boards
still carry nothing but `public_handle` (П10).

Nullable with no server_default on purpose: "не указано" is a legitimate,
common state, and backfilling a guess would put words in people's mouths.

Verify with `alembic upgrade head` against Postgres before deploy.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0010_profile_showcase"
down_revision: str | None = "0009_daily"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("user", sa.Column("method", sa.String(length=16), nullable=True))
    op.add_column("user", sa.Column("cubing_since_year", sa.Integer(), nullable=True))


def downgrade() -> None:
    op.drop_column("user", "cubing_since_year")
    op.drop_column("user", "method")
