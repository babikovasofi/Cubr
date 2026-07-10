"""cubes table + solves.cube_id (nullable FK, SET NULL)

Revision ID: 0003_cubes
Revises: 0002_oauth_accounts
Create Date: 2026-07-10

HAND-WRITTEN (Docker/Postgres unavailable to `alembic revision --autogenerate`
at authoring time). Mirrors ``app.models.cube.Cube`` and the new
``solves.cube_id`` column. ``color_profile`` renders JSONB on Postgres. The
solves->cubes FK is ``ondelete=SET NULL`` so a solve survives deletion of the
cube it referenced (the user->cubes FK is CASCADE). Verify with
`alembic upgrade head` against Postgres before deploy.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "0003_cubes"
down_revision: str | None = "0002_oauth_accounts"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "cubes",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("name", sa.String(length=64), nullable=False),
        sa.Column("note", sa.String(length=255), nullable=True),
        sa.Column("is_primary", sa.Boolean(), server_default="false", nullable=False),
        # color_profile: 6 positional-face (U/R/F/D/L/B) Lab reference triples.
        sa.Column(
            "color_profile",
            sa.JSON().with_variant(postgresql.JSONB(), "postgresql"),
            nullable=False,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "recalibrated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["user_id"], ["user.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_cubes_user_id", "cubes", ["user_id"], unique=False)

    # solves.cube_id: nullable FK, SET NULL — solves outlive their cube.
    op.add_column(
        "solves",
        sa.Column("cube_id", postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.create_foreign_key(
        "fk_solves_cube_id_cubes",
        "solves",
        "cubes",
        ["cube_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index(op.f("ix_solves_cube_id"), "solves", ["cube_id"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_solves_cube_id"), table_name="solves")
    op.drop_constraint("fk_solves_cube_id_cubes", "solves", type_="foreignkey")
    op.drop_column("solves", "cube_id")
    op.drop_index("ix_cubes_user_id", table_name="cubes")
    op.drop_table("cubes")
