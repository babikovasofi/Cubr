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

from collections.abc import Awaitable, Callable

from fastapi import Request
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
