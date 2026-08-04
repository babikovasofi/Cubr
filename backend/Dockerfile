# Cubr API image. Two stages so the runtime layer carries the virtualenv and the
# app, but neither the uv cache nor the dev dependency group.
#
# ONE worker, always. app/main.py's lifespan refuses to boot when
# WEB_CONCURRENCY > 1: link-invite duel rooms live in one process's memory
# (app/services/duel_manager.py), so a second worker would answer WS handshakes
# for rooms it has never heard of. The platform must also keep replicas at 1 —
# see railway.json (numReplicas) and docs/deploy.md.

FROM ghcr.io/astral-sh/uv:python3.12-bookworm-slim AS build

ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PYTHON_DOWNLOADS=never

WORKDIR /app

# Dependencies resolve from the lockfile alone, in their own layer: editing app
# code does not re-resolve or re-download anything.
COPY pyproject.toml uv.lock ./
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen --no-install-project --no-dev

COPY . .
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen --no-dev


FROM python:3.12-slim-bookworm AS runtime

# PYTHONUNBUFFERED: platform log collectors read stdout live, and a buffered
# crash log is a lost crash log.
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PATH="/app/.venv/bin:$PATH"

# Non-root: nothing in this image writes to disk (uploads go nowhere, logs go to
# stdout), so the runtime has no reason to own its own files.
RUN useradd --create-home --uid 10001 cubr
WORKDIR /app
COPY --from=build --chown=cubr:cubr /app /app
USER cubr

EXPOSE 8000

# $PORT is injected by the platform; 8000 keeps `docker run -p 8000:8000` working
# locally. --proxy-headers + --forwarded-allow-ips are NOT set here: the app adds
# its own ProxyHeadersMiddleware with the TRUSTED_PROXIES allowlist (see
# app/main.py), and uvicorn's copy would rewrite the client IP first, from any
# source, defeating that allowlist.
CMD ["sh", "-c", "exec uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000} --workers 1"]
