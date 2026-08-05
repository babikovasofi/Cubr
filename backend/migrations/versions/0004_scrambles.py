"""scrambles table + solves.scramble_id (nullable FK, SET NULL)

Revision ID: 0004_scrambles
Revises: 0003_cubes
Create Date: 2026-07-17

HAND-WRITTEN (Docker/Postgres unavailable to `alembic revision --autogenerate`
at authoring time). Mirrors ``app.models.scramble.Scramble`` and the new
``solves.scramble_id`` column. The scrambles table is populated lazily by
POST /solves only — GET /scramble is stateless and never writes (see
``app.services.scramble_token`` for the signed-token contract). ``nonce``
carries a UNIQUE index enforcing one-time-use at the DB layer. The
solves->scrambles FK is ``ondelete=SET NULL`` so a solve survives deletion of
the scramble row it referenced (mirrors the 0003 cube_id precedent exactly).
Verify with `alembic upgrade head` against Postgres before deploy.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "0004_scrambles"
down_revision: str | None = "0003_cubes"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "scrambles",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("event", sa.String(length=16), server_default="333", nullable=False),
        sa.Column("scramble", sa.String(length=512), nullable=False),
        sa.Column("nonce", sa.String(length=64), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_scrambles_nonce", "scrambles", ["nonce"], unique=True)

    # solves.scramble_id: nullable FK, SET NULL — solves outlive their scramble.
    op.add_column(
        "solves",
        sa.Column("scramble_id", postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.create_foreign_key(
        "fk_solves_scramble_id_scrambles",
        "solves",
        "scrambles",
        ["scramble_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index(op.f("ix_solves_scramble_id"), "solves", ["scramble_id"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_solves_scramble_id"), table_name="solves")
    op.drop_constraint("fk_solves_scramble_id_scrambles", "solves", type_="foreignkey")
    op.drop_column("solves", "scramble_id")
    op.drop_index("ix_scrambles_nonce", table_name="scrambles")
    op.drop_table("scrambles")
