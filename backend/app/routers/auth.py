"""Auth routes: fastapi-users routers under `/auth` + `/users`, each guarded by a
rate-limit dependency, plus a custom Google OAuth router whose callback issues a
`RedirectResponse(FRONTEND_URL)` (instead of the stock 204) once the auth cookie
is set.
"""

import secrets

import jwt
from fastapi import APIRouter, Depends, Query, Request, Response, status
from fastapi.responses import RedirectResponse
from httpx_oauth.integrations.fastapi import OAuth2AuthorizeCallback
from httpx_oauth.oauth2 import OAuth2Token
from fastapi_users.exceptions import UserAlreadyExists
from fastapi_users.jwt import decode_jwt
from fastapi_users.manager import BaseUserManager
from fastapi_users.router.common import ErrorCode
from fastapi_users.router.oauth import (
    CSRF_TOKEN_KEY,
    STATE_TOKEN_AUDIENCE,
    OAuth2AuthorizeResponse,
    generate_csrf_token,
    generate_state_token,
)

from app.config import get_settings
from app.services.auth import (
    auth_backend,
    current_active_user,
    fastapi_users,
    get_jwt_strategy,
    get_user_manager,
    google_oauth_client,
)
from app.services.ratelimit import email_rate_limit, ip_rate_limit
from app.schemas.user import UserCreate, UserRead, UserUpdate

settings = get_settings()

_ip_limit = Depends(ip_rate_limit(settings.AUTH_RATE_LIMIT))
_email_limit = Depends(email_rate_limit(settings.EMAIL_RATE_LIMIT))

_CSRF_COOKIE = "cubr_oauth_csrf"

router = APIRouter()

# /auth/login, /auth/logout — IP rate limited.
router.include_router(
    fastapi_users.get_auth_router(auth_backend),
    prefix="/auth",
    tags=["auth"],
    dependencies=[_ip_limit],
)

# /auth/register — IP + per-target-email rate limited (sends verification mail).
router.include_router(
    fastapi_users.get_register_router(UserRead, UserCreate),
    prefix="/auth",
    tags=["auth"],
    dependencies=[_ip_limit, _email_limit],
)

# /auth/request-verify-token (email in body) + /auth/verify (token in body).
router.include_router(
    fastapi_users.get_verify_router(UserRead),
    prefix="/auth",
    tags=["auth"],
    dependencies=[_ip_limit, _email_limit],
)

# /auth/forgot-password (email in body) + /auth/reset-password (token in body).
router.include_router(
    fastapi_users.get_reset_password_router(),
    prefix="/auth",
    tags=["auth"],
    dependencies=[_ip_limit, _email_limit],
)

# /users/me — protected route.
router.include_router(
    fastapi_users.get_users_router(UserRead, UserUpdate),
    prefix="/users",
    tags=["users"],
)


def _build_google_oauth_router() -> APIRouter:
    """Google OAuth: authorize + a redirecting callback.

    Reimplemented (not the stock router) so the callback returns a
    ``RedirectResponse(FRONTEND_URL)`` carrying the auth cookie, and so the
    ``email_verified`` check lives in our ``UserManager.oauth_callback``.
    """
    oauth_router = APIRouter()
    state_secret = settings.RESET_VERIFY_SECRET
    redirect_url = settings.GOOGLE_OAUTH_REDIRECT_URL
    authorize_callback = OAuth2AuthorizeCallback(google_oauth_client, redirect_url=redirect_url)

    @oauth_router.get(
        "/authorize",
        name="oauth:google.cookie.authorize",
        response_model=OAuth2AuthorizeResponse,
    )
    async def authorize(
        request: Request,
        response: Response,
        scopes: list[str] = Query(None),
    ) -> OAuth2AuthorizeResponse:
        csrf_token = generate_csrf_token()
        state = generate_state_token({CSRF_TOKEN_KEY: csrf_token}, state_secret)
        authorization_url = await google_oauth_client.get_authorization_url(
            redirect_url, state, scopes
        )
        response.set_cookie(
            _CSRF_COOKIE,
            csrf_token,
            max_age=3600,
            secure=settings.cookie_secure,
            httponly=True,
            samesite=settings.COOKIE_SAMESITE,
        )
        return OAuth2AuthorizeResponse(authorization_url=authorization_url)

    def _callback_redirect(*, ok: bool, error: str | None = None) -> RedirectResponse:
        """Redirect the browser back to the SPA callback route so it can parse
        the outcome from the query string (?ok=1 or ?error=<code>)."""
        query = "?ok=1" if ok else f"?error={error}"
        target = f"{settings.FRONTEND_URL}/auth/callback{query}"
        response = RedirectResponse(target, status_code=status.HTTP_302_FOUND)
        response.delete_cookie(_CSRF_COOKIE)
        return response

    @oauth_router.get("/callback", name="oauth:google.cookie.callback")
    async def callback(
        request: Request,
        access_token_state: tuple[OAuth2Token, str] = Depends(authorize_callback),
        user_manager: BaseUserManager = Depends(get_user_manager),  # type: ignore[type-arg]
    ) -> Response:
        token, state = access_token_state
        try:
            state_data = decode_jwt(state, state_secret, [STATE_TOKEN_AUDIENCE])
        except jwt.PyJWTError:
            return _callback_redirect(ok=False, error=ErrorCode.OAUTH_INVALID_STATE)

        cookie_csrf = request.cookies.get(_CSRF_COOKIE)
        state_csrf = state_data.get(CSRF_TOKEN_KEY)
        if not cookie_csrf or not state_csrf or not secrets.compare_digest(cookie_csrf, state_csrf):
            return _callback_redirect(ok=False, error=ErrorCode.OAUTH_INVALID_STATE)

        account_id, account_email = await google_oauth_client.get_id_email(token["access_token"])
        if account_email is None:
            return _callback_redirect(ok=False, error=ErrorCode.OAUTH_NOT_AVAILABLE_EMAIL)

        try:
            user = await user_manager.oauth_callback(
                google_oauth_client.name,
                token["access_token"],
                account_id,
                account_email,
                token.get("expires_at"),
                token.get("refresh_token"),
                request,
                associate_by_email=True,
                is_verified_by_default=True,
            )
        except UserAlreadyExists:
            return _callback_redirect(ok=False, error=ErrorCode.OAUTH_USER_ALREADY_EXISTS)

        if not user.is_active:
            return _callback_redirect(ok=False, error=ErrorCode.LOGIN_BAD_CREDENTIALS)

        # Set the auth cookie, then redirect the browser back to the SPA.
        strategy = get_jwt_strategy()
        login_response = await auth_backend.login(strategy, user)
        await user_manager.on_after_login(user, request)

        redirect = _callback_redirect(ok=True)
        for set_cookie in login_response.headers.getlist("set-cookie"):
            redirect.raw_headers.append((b"set-cookie", set_cookie.encode("latin-1")))
        return redirect

    return oauth_router


router.include_router(
    _build_google_oauth_router(),
    prefix="/auth/google",
    tags=["auth"],
    dependencies=[_ip_limit],
)

# Re-export for convenience / explicitness.
__all__ = ["router", "current_active_user"]
