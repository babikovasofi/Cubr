from fastapi_users_db_sqlalchemy import SQLAlchemyBaseOAuthAccountTableUUID
from sqlalchemy import Index

from app.db import Base


class OAuthAccount(SQLAlchemyBaseOAuthAccountTableUUID, Base):
    """Linked external OAuth account (e.g. Google).

    Inherits UUID PK, ``user_id`` FK (``ondelete=CASCADE``), ``oauth_name`` /
    ``access_token`` / ``expires_at`` / ``refresh_token`` / ``account_id`` /
    ``account_email`` from the fastapi-users base table (``oauth_account``).
    """

    # The base does not index user_id; add it for FK-lookup / cascade-delete perf.
    __table_args__ = (Index("ix_oauth_account_user_id", "user_id"),)
