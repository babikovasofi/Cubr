"""WS-only cookie-JWT authentication.

`fastapi_users`' `current_active_user` HTTP dependency has no WS equivalent.
This reads the auth cookie directly off `WebSocket.cookies`, verifies it with
the SAME `JWTStrategy`/`SECRET` as the HTTP auth backend
(`app.services.auth.auth_backend`), and loads the user via `UserManager`.
`JWTStrategy.read_token` already fails closed internally (catches
`jwt.PyJWTError` / unknown-user lookups and returns `None` — never raises)
so this function mirrors that: `None` on ANY failure (missing cookie, bad/
expired JWT, inactive user). The caller (the WS router) is responsible for
closing the socket (4401) since a WS handshake can't return an HTTP 401.

Deliberately NOT sufficient on its own for duel auth (CSWSH): a valid cookie
alone only proves "this is a logged-in user", not "this is the player this
room's invite was issued to". `app.routers.duel`'s WS handshake additionally
requires an Origin-allowlist check AND a `duel_token.verify(...)`-checked
`?token=` bound to `(room_id, user_id)` — a WS handshake isn't covered by
CORS/CSRF the way an HTTP request is (browsers freely send cookies on a
cross-origin WS handshake), so the cookie check here is necessary but not
sufficient.
"""

import uuid

from fastapi import WebSocket
from fastapi_users_db_sqlalchemy import SQLAlchemyUserDatabase
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.models import OAuthAccount, User
from app.services.auth import UserManager, get_jwt_strategy, password_helper

settings = get_settings()


async def get_ws_user(websocket: WebSocket, session: AsyncSession) -> User | None:
    """Best-effort cookie-JWT auth for a WS handshake. `None` on any failure."""
    token = websocket.cookies.get(settings.COOKIE_NAME)
    if token is None:
        return None

    strategy = get_jwt_strategy()
    user_db: SQLAlchemyUserDatabase[User, uuid.UUID] = SQLAlchemyUserDatabase(
        session, User, OAuthAccount
    )
    user_manager = UserManager(user_db, password_helper)
    user = await strategy.read_token(token, user_manager)
    if user is None or not user.is_active:
        return None
    return user
