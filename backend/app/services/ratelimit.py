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
from contextlib import asynccontextmanager

from fastapi import Depends, HTTPException, Request
from limits import RateLimitItem, parse
from limits.aio.storage import MemoryStorage
from limits.aio.strategies import MovingWindowRateLimiter
from slowapi import Limiter
from slowapi.errors import RateLimitExceeded
from slowapi.util import get_remote_address
from slowapi.wrappers import Limit

from app.config import get_settings
from app.models import User
from app.services.auth import current_active_user

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


@asynccontextmanager
async def _outcome_gated_budget(item: RateLimitItem, key: str) -> AsyncIterator[None]:
    """Shared body for a rate limit that must only spend budget on a FAILED
    attempt and give the budget back in full on success — used by both
    `ip_rate_limit` (on `/auth/login` only) and `login_account_rate_limit`.

    Peek the budget without consuming it (`_window.test`) and reject up
    front (429, via the same `_raise` everyone else uses) if it's already
    exhausted. Otherwise let the wrapped path operation run: on success (no
    exception propagates back) CLEAR the counter for `key`; on failure
    (`HTTPException` — LOGIN_BAD_CREDENTIALS et al.) spend one unit via
    `_window.hit` and re-raise unchanged.

    A single shared helper, not two copies, because both callers are the
    *same* policy applied to two different keys (per-IP, per-account) —
    factoring out the copy wouldn't blur what each limit means; it's the
    literal thing they have in common. What keeps their meanings apart is
    the `key` each caller builds (`ip:...` vs `login-account:...`) and
    *where* each is willing to apply it — that stays in the two callers.
    """
    if not await _window.test(item, key):
        _raise(item, _client_ip)
    try:
        yield
    except HTTPException:
        await _window.hit(item, key)
        raise
    else:
        await _window.clear(item, key)


def ip_rate_limit(limit: str) -> Callable[[Request], AsyncIterator[None]]:
    """Dependency: throttle by client IP (`AUTH_RATE_LIMIT` style).

    Everywhere except `/auth/login` this is the original "hit on every
    request" shape: for register / verify / forgot-password / reset-password
    / the google oauth redirect, a *successful* call is precisely the event
    being throttled (it sends mail, or changes account state) — so success
    must keep costing budget there.

    On `/auth/login` specifically it switches to the outcome-gated shape
    (`_outcome_gated_budget`, shared with `login_account_rate_limit`): a
    person who logs in correctly many times in a row from one IP (retries,
    a second tab, a flaky network) must not trip this — only wrong guesses
    should. Brute-forcing many DIFFERENT accounts from one IP still trips
    it exactly as before, since every failed guess from that IP still spends
    the same per-IP bucket regardless of which account it targeted.
    """
    item = parse(limit)

    async def dependency(request: Request) -> AsyncIterator[None]:
        key = f"ip:{request.scope.get('path', '')}:{_client_ip(request)}"
        if not request.url.path.endswith("/login"):
            if not await _window.hit(item, key):
                _raise(item, _client_ip)
            yield
            return
        async with _outcome_gated_budget(item, key):
            yield

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

    This is a yield-dependency instead, built on the same outcome-gated
    shape as `ip_rate_limit`'s `/auth/login` case — see
    `_outcome_gated_budget` for the peek/clear/hit mechanics.

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
        async with _outcome_gated_budget(item, key):
            yield

    return dependency


def user_rate_limit(limit: str) -> Callable[[Request, User], Awaitable[None]]:
    """Dependency: throttle by the CALLING user's `user.id` — for authed
    endpoints where an IP-keyed limit is not a real defense (rotating IP /
    a second worker resets it). First use: `POST /friends/requests`, where
    the thing being throttled is enumerating which `handle`s exist
    (see `app.routers.friends`, `app.services.friends` module docstring).

    Mirrors `login_account_rate_limit`'s SHAPE — a per-account dependency
    layered on top of its own `Depends(current_active_user)`, so it shares
    FastAPI's per-request dependency cache with the route handler's own
    `current_active_user` (one DB lookup, not two) — but deliberately NOT
    its outcome-gated semantics. `login_account_rate_limit` only spends
    budget on a FAILED login so retyping a correct password a few times
    never trips it; there is no equivalent "wrong guess" signal here; every
    call — success or failure — spends one unit of budget, same as the
    plain `ip_rate_limit` shape. A key built from `user.id` (never the raw
    handle being probed) so the limit stays about "how often did this
    ACCOUNT call this endpoint", not about any one target.
    """
    item = parse(limit)

    async def dependency(request: Request, user: User = Depends(current_active_user)) -> None:
        key = f"friend-request:{user.id}"
        if not await _window.hit(item, key):
            _raise(item, _client_ip)

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
