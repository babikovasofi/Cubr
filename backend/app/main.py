from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware
from uvicorn.middleware.proxy_headers import ProxyHeadersMiddleware

from app.config import get_settings
from app.routers import auth, cubes, health, solves
from app.services.ratelimit import limiter

settings = get_settings()

app = FastAPI(title="Cubr API")


async def _rate_limit_handler(request: Request, exc: Exception) -> JSONResponse:
    """429 for our dependency-raised RateLimitExceeded.

    We can't use slowapi's stock handler: it reads `request.state.view_rate_limit`
    which only the `@limiter.limit` decorator sets — and that decorator does not
    compose with the fastapi-users routers we mount (see ratelimit.py).
    """
    assert isinstance(exc, RateLimitExceeded)
    item = exc.limit.limit if exc.limit is not None else None
    detail = f"Rate limit exceeded: {item}" if item is not None else "Rate limit exceeded"
    headers = {"Retry-After": str(item.get_expiry())} if item is not None else {}
    return JSONResponse(status_code=429, content={"detail": detail}, headers=headers)


# Rate limiting: expose the limiter (for SlowAPIMiddleware) + 429 handler.
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_handler)

# add_middleware stacks outermost-last. ProxyHeadersMiddleware is added last so it
# is the OUTERMOST layer and rewrites request.client.host from X-Forwarded-For
# (trusted proxies only) BEFORE the rate limiter reads the client IP.
app.add_middleware(SlowAPIMiddleware)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.add_middleware(ProxyHeadersMiddleware, trusted_hosts=settings.trusted_proxies)

app.include_router(health.router)
app.include_router(auth.router)
# Mounted at root (no `/api` prefix): the frontend proxy strips `/api`.
app.include_router(solves.router)
app.include_router(cubes.router)
