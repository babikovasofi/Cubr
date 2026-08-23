"""fastapi-users wiring: argon2 hashing, JWT-in-cookie backend, UserManager.

Security notes
--------------
* Password hashing is **argon2id** (pwdlib), not bcrypt.
* Reset / verification tokens are signed with ``RESET_VERIFY_SECRET`` — a
  separate secret from the auth-JWT ``SECRET`` (blast-radius split).
* OAuth: the custom ``oauth_callback`` verifies the provider's ``email_verified``
  claim before it will ``associate_by_email`` or mark the user verified, and
  derives a handle (the ORM column is nullable so the stock create succeeds).
"""

import logging
import uuid
from collections.abc import AsyncGenerator

import httpx
from fastapi import Depends, HTTPException, Request, status
from fastapi_users import BaseUserManager, FastAPIUsers, UUIDIDMixin, schemas
from fastapi_users.authentication import (
    AuthenticationBackend,
    CookieTransport,
    JWTStrategy,
)
from fastapi_users.exceptions import InvalidPasswordException, UserAlreadyExists
from fastapi_users.password import PasswordHelper
from fastapi_users_db_sqlalchemy import SQLAlchemyUserDatabase
from httpx_oauth.clients.google import GoogleOAuth2
from pwdlib import PasswordHash
from pwdlib.hashers.argon2 import Argon2Hasher
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.db import get_user_db
from app.models import User
from app.services import email as email_service
from app.services.moderation import check_display_name, sanitize_derived_handle
from app.services.password_policy import check_password_policy

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


def _derive_handle(email: str) -> str:
    """Best-effort handle from the email local-part (max 64 chars).

    Run through the name filter too: the local-part is not user-typed *here*,
    but it still ends up as a display name, so a rude one falls back to "cuber"
    instead of failing the OAuth redirect (see `sanitize_derived_handle`).
    Uniqueness against an existing handle is NOT this function's job — the
    caller (`oauth_callback`) handles a collision on write.
    """
    local = email.split("@", 1)[0].strip() or "cuber"
    return sanitize_derived_handle(local[:64])


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


_HANDLE_TAKEN_DETAIL = {"code": "HANDLE_TAKEN", "reason": "Этот хэндл уже занят."}


def _handle_taken_error() -> HTTPException:
    return HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=_HANDLE_TAKEN_DETAIL)


def _reject_bad_names(*values: object) -> None:
    """Stage 6 name filter — raises 400 with the SPA's `{code, reason}` shape.

    Deliberately not a pydantic validator: pydantic answers 422 with a
    `detail[]` array, which `api/client.ts` collapses into the generic "что-то
    пошло не так" — indistinguishable from a server error. The manager layer can
    speak the same `detail: {code, reason}` dialect as CUBE_LIMIT.
    """
    for value in values:
        if not isinstance(value, str):
            continue
        rejection = check_display_name(value)
        if rejection is not None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail={"code": rejection.code, "reason": rejection.reason},
            )


class UserManager(UUIDIDMixin, BaseUserManager[User, uuid.UUID]):
    reset_password_token_secret = settings.RESET_VERIFY_SECRET
    verification_token_secret = settings.RESET_VERIFY_SECRET

    def __init__(
        self,
        user_db: SQLAlchemyUserDatabase[User, uuid.UUID],
        password_helper: PasswordHelper | None = None,
    ) -> None:
        super().__init__(user_db, password_helper)
        # `BaseUserManager.user_db` is typed as the abstract `BaseUserDatabase`
        # (no `.session`) — stash the concrete session here so the
        # `HANDLE_TAKEN` pre-check/race-guard in `update()` below has a
        # properly-typed `AsyncSession` to query/rollback, instead of reaching
        # through `self.user_db` (which mypy can't see `.session` on).
        self._session: AsyncSession = user_db.session

    async def validate_password(self, password: str, user: schemas.UC | User) -> None:
        # Same check on every path that SETS a password — register, the
        # forgot/reset-password flow, and PATCH /users/me — because
        # BaseUserManager routes all three through here (create() calls this
        # directly; reset_password()/update() both call it via _update()).
        # Login never does (see BaseUserManager.authenticate), so accounts
        # created before this policy existed keep working.
        rejection = check_password_policy(
            password,
            email=getattr(user, "email", None),
            handle=getattr(user, "handle", None),
        )
        if rejection is not None:
            # fastapi-users' stock routers catch this and answer
            # 400 {"code": "<ENDPOINT>_INVALID_PASSWORD", "reason": ...} —
            # never a bare 422 (see password_policy.py's module docstring).
            raise InvalidPasswordException(reason=rejection.reason)

    async def create(
        self,
        user_create: schemas.UC,
        safe: bool = False,
        request: Request | None = None,
    ) -> User:
        # Registration may carry a handle; refuse before the row exists.
        new_handle = getattr(user_create, "handle", None)
        _reject_bad_names(new_handle)
        # Same pre-check as `update()` below — registration is now a second
        # write path that can set the unique `handle` column (previously
        # only PATCH /users/me could), so it needs the same race-guarded
        # collision handling. `None`/blank means "not set" (see
        # `_normalize_handle` in `app.schemas.user`) — never pre-checked.
        if isinstance(new_handle, str) and new_handle:
            existing = await self._session.execute(
                select(User.__table__.c.id).where(
                    func.lower(User.handle) == new_handle.strip().lower()
                )
            )
            if existing.scalar_one_or_none() is not None:
                raise _handle_taken_error()
        try:
            return await super().create(user_create, safe, request)
        except IntegrityError as exc:
            await self._session.rollback()
            raise _handle_taken_error() from exc

    async def update(
        self,
        user_update: schemas.UU,
        user: User,
        safe: bool = False,
        request: Request | None = None,
    ) -> User:
        # PATCH /users/me — the ONE name field, reaching both the owner's own
        # surfaces and other people (friends, tournament / daily boards, П10).
        new_handle = getattr(user_update, "handle", None)
        _reject_bad_names(new_handle)
        # `app.models.user`'s `uq_user_handle_lower`: `handle` is
        # case-insensitively unique. Pre-check BEFORE the write so a normal
        # collision gets the same human `{code, reason}` shape as
        # CUBE_LIMIT/NAME_* instead of a bare DB error. `None`/blank means
        # "not being set / being cleared" (see `_normalize_handle` in
        # `app.schemas.user`) — never pre-checked, or clearing to NULL or
        # leaving the field out entirely would false-positive against every
        # other handle-less user.
        if isinstance(new_handle, str) and new_handle:
            # `User.id` (via `.__table__.c`, not the bare attribute):
            # fastapi-users' base table declares `id` `if TYPE_CHECKING:
            # id: UUID_ID`, which shadows the real mapped column for mypy —
            # same workaround `app.services.funnel` already uses for
            # `is_verified`.
            existing = await self._session.execute(
                select(User.__table__.c.id).where(
                    func.lower(User.handle) == new_handle.strip().lower(),
                    User.__table__.c.id != user.id,
                )
            )
            if existing.scalar_one_or_none() is not None:
                raise _handle_taken_error()
        # Race guard: two concurrent PATCHes both pass the pre-check above,
        # then both write — the UNIQUE index catches the loser as an
        # `IntegrityError` at commit (inside `user_db.update()`), mapped to
        # the SAME `HANDLE_TAKEN` shape rather than a raw 500. The session's
        # transaction is aborted at that point, so it must be rolled back
        # before it can be used again (e.g. by a later test/request on the
        # same connection).
        try:
            return await super().update(user_update, user, safe, request)
        except IntegrityError as exc:
            await self._session.rollback()
            raise _handle_taken_error() from exc

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

        # Второй замок, на другую половину той же атаки.
        #
        # Проверка выше отвечает за сторону Google. Но связывание по адресу
        # смотрит и на НАШУ запись, а fastapi-users, найдя локального
        # пользователя с тем же адресом, привязывает OAuth к нему, не спрашивая,
        # подтверждён ли тот аккаунт. Отсюда классический pre-hijack:
        # злоумышленник заранее регистрирует парольный аккаунт на чужой адрес
        # (подтверждение адреса ничего не требует и в проде пока не работает
        # вовсе — RESEND_API_KEY пуст), знает от него пароль; позже владелец
        # адреса входит через Google, адреса совпадают — и его вход приземляется
        # в аккаунт злоумышленника, вместе со сборками, дуэлями и профилем.
        #
        # Поэтому связываем по адресу ТОЛЬКО с подтверждённой локальной записью.
        # Неподтверждённая — отказ с той же ошибкой, что и «адрес занят»: человек
        # видит «войди паролем», а не молча попадает в чужой аккаунт.
        #
        # Аккаунт, УЖЕ связанный с этим провайдером, проверку не проходит: это
        # не связывание, а повторный вход, и владение адресом доказано ровно тем
        # же способом, что и в прошлый раз.
        if associate_by_email:
            existing = await self.user_db.get_by_email(account_email)
            already_linked = existing is not None and any(
                a.oauth_name == oauth_name for a in getattr(existing, "oauth_accounts", [])
            )
            if existing is not None and not already_linked and not existing.is_verified:
                raise UserAlreadyExists()

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
        # handle is nullable; derive one on first OAuth sign-up.
        if not user.handle:
            derived = _derive_handle(account_email)
            try:
                user = await self.user_db.update(user, {"handle": derived})
            except IntegrityError:
                # Two different OAuth signups can derive the same
                # local-part (e.g. "john@gmail.com" and "john@yahoo.com").
                # `handle` is unique — don't fail the login over it. Suffix
                # with the row's OWN id, which by definition cannot already
                # be taken, so this always succeeds without a retry loop.
                await self._session.rollback()
                fallback = f"{derived[:54]}-{user.id.hex[:8]}"
                user = await self.user_db.update(user, {"handle": fallback})
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
# Operator-only surfaces (Stage 6 funnel): anon -> 401, ordinary user -> 403.
current_superuser = fastapi_users.current_user(active=True, superuser=True)
