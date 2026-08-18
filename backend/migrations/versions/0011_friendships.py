"""friendships table + case-insensitive unique index on user.public_handle

Revision ID: 0011_friendships
Revises: 0010_profile_showcase
Create Date: 2026-08-18

HAND-WRITTEN (mirrors 0007_duel_rooms' style; Docker/Postgres unavailable to
`alembic revision --autogenerate` at authoring time). Mirrors
``app.models.friendship.Friendship`` and the ``uq_user_public_handle_lower``
index added to ``app.models.user.User``.

``friendships`` carries THREE check constraints, not just the pair
UNIQUE(user_low_id, user_high_id):

* ``ck_friendships_ordered_pair`` (``user_low_id < user_high_id``) —
  enforces the canonical pair ordering AND, as a side effect of the strict
  ``<``, makes self-friendship physically impossible (a row can never have
  ``user_low_id == user_high_id``).
* ``ck_friendships_requested_by_in_pair`` — ``requested_by_id`` must be one
  of the two people in the pair it names.
* ``ck_friendships_status`` — app-level enum, DB-enforced (mirrors
  ``app.models.duel``'s status columns).

Together with ``uq_friendships_pair``, a mirrored insert of the same pair in
the other order is an ``IntegrityError`` at the DB layer, not merely a
service-layer check — see ``app.services.friends.send_request``'s
``session.begin_nested()`` pattern.

``uq_user_public_handle_lower`` is a PARTIAL unique index on
``lower(user.public_handle)`` (``WHERE public_handle IS NOT NULL``) — this
is a change to the EXISTING ``user`` table, not just new tables for this
feature, because "add a friend by handle" is ambiguous without it.

*** MANDATORY before running this migration against ANY database that
already has rows (i.e. anything past a fresh dev DB): check for existing
case-insensitive handle collisions first — the unique index creation FAILS
outright if any exist. ***

    SELECT lower(public_handle), array_agg(id)
    FROM "user"
    WHERE public_handle IS NOT NULL
    GROUP BY lower(public_handle)
    HAVING count(*) > 1;

If that returns any rows, resolve them (ask one of the colliding users to
change their handle) before upgrading.

Verify with `alembic upgrade head` against Postgres before deploy.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "0011_friendships"
down_revision: str | None = "0010_profile_showcase"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "friendships",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("user_low_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("user_high_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("requested_by_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("status", sa.String(length=16), server_default="pending", nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("responded_at", sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_low_id", "user_high_id", name="uq_friendships_pair"),
        sa.CheckConstraint("user_low_id < user_high_id", name="ck_friendships_ordered_pair"),
        sa.CheckConstraint(
            "requested_by_id = user_low_id OR requested_by_id = user_high_id",
            name="ck_friendships_requested_by_in_pair",
        ),
        sa.CheckConstraint("status IN ('pending','accepted')", name="ck_friendships_status"),
    )
    op.create_index(op.f("ix_friendships_user_low_id"), "friendships", ["user_low_id"])
    op.create_index(op.f("ix_friendships_user_high_id"), "friendships", ["user_high_id"])
    op.create_foreign_key(
        "fk_friendships_user_low_id_user",
        "friendships",
        "user",
        ["user_low_id"],
        ["id"],
        ondelete="CASCADE",
    )
    op.create_foreign_key(
        "fk_friendships_user_high_id_user",
        "friendships",
        "user",
        ["user_high_id"],
        ["id"],
        ondelete="CASCADE",
    )
    op.create_foreign_key(
        "fk_friendships_requested_by_id_user",
        "friendships",
        "user",
        ["requested_by_id"],
        ["id"],
        ondelete="CASCADE",
    )

    # Case-insensitive UNIQUE on user.public_handle — see module docstring's
    # MANDATORY pre-check before running this against a populated database.
    # Partial (`WHERE public_handle IS NOT NULL`): plain UNIQUE never treats
    # two NULLs as equal, but the partial predicate additionally keeps
    # handle-less users out of the index entirely.
    op.create_index(
        "uq_user_public_handle_lower",
        "user",
        [sa.text("lower(public_handle)")],
        unique=True,
        postgresql_where=sa.text("public_handle IS NOT NULL"),
    )


def downgrade() -> None:
    op.drop_index("uq_user_public_handle_lower", table_name="user")

    op.drop_constraint("fk_friendships_requested_by_id_user", "friendships", type_="foreignkey")
    op.drop_constraint("fk_friendships_user_high_id_user", "friendships", type_="foreignkey")
    op.drop_constraint("fk_friendships_user_low_id_user", "friendships", type_="foreignkey")
    op.drop_index(op.f("ix_friendships_user_high_id"), table_name="friendships")
    op.drop_index(op.f("ix_friendships_user_low_id"), table_name="friendships")
    op.drop_table("friendships")
