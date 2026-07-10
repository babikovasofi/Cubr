"""fastapi-users wiring: argon2 hashing, JWT-in-cookie backend, UserManager.

Security notes
--------------
* Password hashing is **argon2id** (pwdlib), not bcrypt.
* Reset / verification tokens are signed with ``RESET_VERIFY_SECRET`` — a
  separate secret from the auth-JWT ``SECRET`` (blast-radius split).
* OAuth: the custom ``oauth_callback`` verifies the provider's ``email_verified``
  claim before it will ``associate_by_email`` or mark the user verified, and
  derives a nickname (the ORM column is nullable so the stock create succeeds).
"""

import logging
import uuid
from collections.abc import AsyncGenerator

import httpx
from fastapi import Depends, Request
from fastapi_users import BaseUserManager, FastAPIUsers, UUIDIDMixin
from fastapi_users.authentication import (
    AuthenticationBackend,
    CookieTransport,
    JWTStrategy,
)
from fastapi_users.password import PasswordHelper
from fastapi_users_db_sqlalchemy import SQLAlchemyUserDatabase
from httpx_oauth.clients.google import GoogleOAuth2
from pwdlib import PasswordHash
from pwdlib.hashers.argon2 import Argon2Hasher

from app.config import get_settings
from app.db import get_user_db
from app.models import User
from app.services import email as email_service

logger = logging.getLogger("cubr.auth")

settings = get_settings()

# argon2id password hashing.
password_helper = PasswordHelper(PasswordHash((Argon2Hasher(),)))

# Google OpenID userinfo endpoint — used to read the `email_verified` claim,
# which httpx-oauth's `get_id_email` does not surface.
_GOOGLE_USERINFO = "https://openidconnect.googleapis.com/v1/userinfo"

google_oauth_client = GoogleOAuth2(
    settings.GOOGLE_OAUTH_CLIENT_ID,
    settings.GOOGLE_OAUTH_CLIENT_SECRET,
)


def _derive_nickname(email: str) -> str:
    """Best-effort nickname from the email local-part (max 64 chars)."""
    local = email.split("@", 1)[0].strip() or "cuber"
    return local[:64]


async def google_email_verified(access_token: str) -> bool:
    """Read Google's ``email_verified`` claim for the token holder.

    Mockable seam: tests monkeypatch this rather than call Google. Any failure
    is treated as *not verified* (fail-closed).
    """
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(
                _GOOGLE_USERINFO,
                headers={"Authorization": f"Bearer {access_token}"},
            )
            resp.raise_for_status()
            data = resp.json()
    except (httpx.HTTPError, ValueError):
        logger.warning("Could not read Google email_verified claim; treating as unverified")
        return False
    return bool(data.get("email_verified", False))


class UserManager(UUIDIDMixin, BaseUserManager[User, uuid.UUID]):
    reset_password_token_secret = settings.RESET_VERIFY_SECRET
    verification_token_secret = settings.RESET_VERIFY_SECRET

    async def on_after_register(self, user: User, request: Request | None = None) -> None:
        # Kick off email verification right after sign-up. `request_verify`
        # generates the token and calls `on_after_request_verify` (one send).
        if user.is_active and not user.is_verified:
            await self.request_verify(user, request)

    async def on_after_request_verify(
        self, user: User, token: str, request: Request | None = None
    ) -> None:
        await email_service.send_verification_email(user.email, token)

    async def on_after_forgot_password(
        self, user: User, token: str, request: Request | None = None
    ) -> None:
        await email_service.send_reset_email(user.email, token)

    async def oauth_callback(
        self,
        oauth_name: str,
        access_token: str,
        account_id: str,
        account_email: str,
        expires_at: int | None = None,
        refresh_token: str | None = None,
        request: Request | None = None,
        *,
        associate_by_email: bool = False,
        is_verified_by_default: bool = False,
    ) -> User:
        # Only trust associate-by-email / auto-verify when the provider actually
        # verified the address — otherwise this is an account-takeover vector.
        provider_verified = await google_email_verified(access_token)
        user = await super().oauth_callback(
            oauth_name,
            access_token,
            account_id,
            account_email,
            expires_at,
            refresh_token,
            request,
            associate_by_email=associate_by_email and provider_verified,
            is_verified_by_default=is_verified_by_default and provider_verified,
        )
        # nickname is nullable; derive one on first OAuth sign-up.
        if not user.nickname:
            user = await self.user_db.update(user, {"nickname": _derive_nickname(account_email)})
        return user


async def get_user_manager(
    user_db: SQLAlchemyUserDatabase[User, uuid.UUID] = Depends(get_user_db),
) -> AsyncGenerator[UserManager, None]:
    yield UserManager(user_db, password_helper)


cookie_transport = CookieTransport(
    cookie_name=settings.COOKIE_NAME,
    cookie_max_age=settings.JWT_LIFETIME_SECONDS,
    cookie_secure=settings.cookie_secure,
    cookie_httponly=True,
    cookie_samesite=settings.COOKIE_SAMESITE,
)


def get_jwt_strategy() -> JWTStrategy[User, uuid.UUID]:
    return JWTStrategy(
        secret=settings.SECRET,
        lifetime_seconds=settings.JWT_LIFETIME_SECONDS,
    )


auth_backend = AuthenticationBackend(
    name="cookie",
    transport=cookie_transport,
    get_strategy=get_jwt_strategy,
)


fastapi_users = FastAPIUsers[User, uuid.UUID](get_user_manager, [auth_backend])

current_active_user = fastapi_users.current_user(active=True)
