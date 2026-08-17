"""oauth_account table (Google OAuth linkage)

Revision ID: 0002_oauth_accounts
Revises: 0001_init
Create Date: 2026-07-10

HAND-WRITTEN (Docker/Postgres was unavailable to `alembic revision
--autogenerate` against at authoring time). It mirrors
``fastapi_users_db_sqlalchemy.SQLAlchemyBaseOAuthAccountTableUUID`` exactly
(table ``oauth_account``) plus the app's extra ``ix_oauth_account_user_id``
index declared on the ORM model. The user->oauth_account FK is
``ondelete=CASCADE`` so deleting a user removes their linked accounts.
Verify with `alembic upgrade head` against Postgres before deploy.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "0002_oauth_accounts"
down_revision: str | None = "0001_init"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "oauth_account",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("oauth_name", sa.String(length=100), nullable=False),
        sa.Column("access_token", sa.String(length=1024), nullable=False),
        sa.Column("expires_at", sa.Integer(), nullable=True),
        sa.Column("refresh_token", sa.String(length=1024), nullable=True),
        sa.Column("account_id", sa.String(length=320), nullable=False),
        sa.Column("account_email", sa.String(length=320), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["user.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_oauth_account_account_id"), "oauth_account", ["account_id"], unique=False
    )
    op.create_index(
        op.f("ix_oauth_account_oauth_name"), "oauth_account", ["oauth_name"], unique=False
    )
    op.create_index("ix_oauth_account_user_id", "oauth_account", ["user_id"], unique=False)

    # nickname becomes nullable: OAuth sign-up creates the user before a nickname
    # is derived (see UserManager.oauth_callback).
    op.alter_column("user", "nickname", existing_type=sa.String(length=64), nullable=True)


def downgrade() -> None:
    op.alter_column("user", "nickname", existing_type=sa.String(length=64), nullable=False)
    op.drop_index("ix_oauth_account_user_id", table_name="oauth_account")
    op.drop_index(op.f("ix_oauth_account_oauth_name"), table_name="oauth_account")
    op.drop_index(op.f("ix_oauth_account_account_id"), table_name="oauth_account")
    op.drop_table("oauth_account")
