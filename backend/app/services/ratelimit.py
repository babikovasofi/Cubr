"""Rate limiting.

Mechanism (per the plan, decorators don't compose with fastapi-users routers):
a FastAPI **dependency** that manually checks a limit against the async
``limits`` backend and raises slowapi's ``RateLimitExceeded`` — which the app's
registered handler turns into a 429. A slowapi ``Limiter`` instance is still
exported for ``app.state.limiter`` (required by ``SlowAPIMiddleware`` / the
error handler).

Client IP comes from ``request.client.host`` which is only rewritten from
``X-Forwarded-For`` by uvicorn's ``ProxyHeadersMiddleware`` for *trusted*
proxies (wired in ``main.py``). We never read raw XFF here.
"""

from collections.abc import AsyncIterator, Awaitable, Callable

from fastapi import HTTPException, Request
from limits import RateLimitItem, parse
from limits.aio.storage import MemoryStorage
from limits.aio.strategies import MovingWindowRateLimiter
from slowapi import Limiter
from slowapi.errors import RateLimitExceeded
from slowapi.util import get_remote_address
from slowapi.wrappers import Limit

from app.config import get_settings

settings = get_settings()

# Exported for app.state.limiter + SlowAPIMiddleware / error handler.
limiter = Limiter(key_func=get_remote_address)

# In-process moving-window store. MVP-scoped: per-worker (see plan "out of scope":
# Redis multi-worker hardening is deferred).
_storage = MemoryStorage()
_window = MovingWindowRateLimiter(_storage)


def _client_ip(request: Request) -> str:
    return get_remote_address(request)


def _raise(item: RateLimitItem, key_func: Callable[[Request], str]) -> None:
    raise RateLimitExceeded(
        Limit(
            item,
            key_func,
            scope=None,
            per_method=False,
            methods=None,
            error_message=None,
            exempt_when=None,
            cost=1,
            override_defaults=False,
        )
    )


def ip_rate_limit(limit: str) -> Callable[[Request], Awaitable[None]]:
    """Dependency: throttle by client IP (`AUTH_RATE_LIMIT` style)."""
    item = parse(limit)

    async def dependency(request: Request) -> None:
        key = f"ip:{request.scope.get('path', '')}:{_client_ip(request)}"
        if not await _window.hit(item, key):
            _raise(item, _client_ip)

    return dependency


def email_rate_limit(limit: str) -> Callable[[Request], Awaitable[None]]:
    """Dependency: tighter throttle keyed by the *target email* in the body.

    Sits on top of the IP limit for email-sending endpoints (register / forgot /
    request-verify) so one attacker can't spray verification/reset mail at many
    addresses from rotating IPs. Falls back to IP if no email is present.
    """
    item = parse(limit)

    async def dependency(request: Request) -> None:
        email = await _extract_email(request)
        key = f"email:{request.scope.get('path', '')}:{email or _client_ip(request)}"
        if not await _window.hit(item, key):
            _raise(item, _client_ip)

    return dependency


def login_account_rate_limit(limit: str) -> Callable[[Request], AsyncIterator[None]]:
    """Dependency: throttle `/auth/login` by the *target account*, not IP —
    but only spend budget on attempts that actually FAIL.

    `ip_rate_limit`/`AUTH_RATE_LIMIT` counts attempts per client IP — an
    attacker spraying guesses at ONE account from a hundred rotating IPs
    never trips it. This counts per account (the form's `username` field,
    i.e. the email being attacked) regardless of source IP.

    A plain "hit on every request" dependency (the previous shape) can't see
    the outcome — dependencies run BEFORE the path operation — so it spent a
    unit of budget on every login, successful ones included. A person who
    correctly re-enters their password a handful of times in a row (typos,
    a slow network retry, a second device) would eventually get 429'd
    alongside an actual attacker. Real brute-force defenses only meter
    *wrong* guesses.

    This is a yield-dependency instead, which lets it observe the outcome:
    - before the path op: peek the account's budget WITHOUT consuming it
      (`_window.test`) and reject up front if it's already exhausted;
    - after the path op: on success (no exception — fastapi-users' login
      returns its 204 response and nothing is raised), CLEAR the account's
      counter — a correct password is proof the requester isn't guessing;
      on failure (`HTTPException`, e.g. LOGIN_BAD_CREDENTIALS) spend one
      unit of budget (`_window.hit`) and re-raise unchanged.

    Mounted on the whole fastapi-users auth router (login *and* logout share
    one router — see app.routers.auth), so this checks the request path
    itself and is a no-op off `/login`: logout has no target account, and
    counting it against the IP-fallback bucket would let logout traffic
    spuriously trip an unrelated account's limit.
    """
    item = parse(limit)

    async def dependency(request: Request) -> AsyncIterator[None]:
        if not request.url.path.endswith("/login"):
            yield
            return
        username = await _extract_login_username(request)
        if username is None:
            # No account to key on (malformed body) — the IP limit above
            # still covers this request; don't rate-limit an empty key.
            yield
            return
        key = f"login-account:{username}"
        if not await _window.test(item, key):
            _raise(item, _client_ip)
        try:
            yield
        except HTTPException:
            # A real failed guess (bad credentials, unverified, ...) —
            # this is what the budget is meant to meter.
            await _window.hit(item, key)
            raise
        else:
            # Correct password: this account isn't being brute-forced right
            # now, so give it its full budget back.
            await _window.clear(item, key)

    return dependency


async def _extract_login_username(request: Request) -> str | None:
    """Read the `username` form field (OAuth2PasswordRequestForm's email) for
    `/auth/login`, without consuming it for downstream parsing — Starlette
    caches parsed form data on the request, so reading it here is safe (same
    reasoning as `_extract_email` for JSON bodies)."""
    try:
        form = await request.form()
    except Exception:
        return None
    value = form.get("username")
    if isinstance(value, str):
        value = value.strip().lower()
        return value or None
    return None


async def _extract_email(request: Request) -> str | None:
    """Read the `email` field from a JSON body without consuming it for downstream.

    Starlette caches the body on the request, so reading it here is safe — the
    router body-parsing that follows reuses the same cached bytes.
    """
    try:
        body = await request.json()
    except (ValueError, RuntimeError):
        return None
    if isinstance(body, dict):
        value = body.get("email")
        if isinstance(value, str):
            return value.strip().lower()
    return None


async def reset_limiter_state() -> None:
    """Clear all counters — used by tests to isolate rate-limit cases."""
    await _storage.reset()
