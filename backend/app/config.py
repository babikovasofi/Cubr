from functools import lru_cache
from typing import Literal

from pydantic import Field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

# Banned fragments: a secret CONTAINING any of these (even when padded to >=32
# chars) is rejected as an obvious placeholder / committed default. Enforced in
# EVERY environment (incl. local) so a deploy that forgets to set APP_ENV cannot
# boot with the committed `.env.example` placeholders.
_PLACEHOLDER_FRAGMENTS = (
    "change-me",
    "changeme",
    "change_me",
    "placeholder",
    "example",
)


class Settings(BaseSettings):
    """Application settings, loaded from environment / `.env`."""

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    DATABASE_URL: str = "postgresql+asyncpg://cubr:cubr@localhost:5432/cubr"
    CORS_ORIGINS: str = "http://localhost:5173,http://127.0.0.1:5173"
    APP_ENV: str = "local"

    # --- Secrets (fail-closed: no default → boot raises ValidationError if unset) ---
    # Auth JWT signing secret.
    SECRET: str = Field(min_length=32)
    # Separate secret for password-reset / email-verification tokens (split from auth JWT).
    RESET_VERIFY_SECRET: str = Field(min_length=32)
    # Separate secret signing GET /scramble -> POST /solves tokens (split from both above).
    SCRAMBLE_SIGN_SECRET: str = Field(min_length=32)
    # Separate secret signing duel WS session/reconnect tokens (split from all of the above).
    DUEL_SIGN_SECRET: str = Field(min_length=32)

    # --- Auth cookie ---
    JWT_LIFETIME_SECONDS: int = 3600
    COOKIE_NAME: str = "cubr_auth"
    COOKIE_SAMESITE: Literal["lax", "strict", "none"] = "lax"

    # --- Frontend / redirect ---
    FRONTEND_URL: str = "http://localhost:5173"

    # --- Email delivery ---
    EMAIL_FROM: str = "Cubr <no-reply@cubr-game.ru>"
    EMAIL_PROVIDER: Literal["resend", "brevo"] = "resend"
    RESEND_API_KEY: str = ""
    BREVO_API_KEY: str = ""

    # --- Google OAuth ---
    GOOGLE_OAUTH_CLIENT_ID: str = ""
    GOOGLE_OAUTH_CLIENT_SECRET: str = ""
    GOOGLE_OAUTH_REDIRECT_URL: str = "http://localhost:5173/api/auth/google/callback"

    # --- Rate limiting ---
    AUTH_RATE_LIMIT: str = "10/minute"
    # Login attempts against a single ACCOUNT (keyed by the email being
    # attacked), on top of AUTH_RATE_LIMIT's per-IP window — otherwise an
    # attacker spraying guesses from rotating IPs never gets throttled.
    LOGIN_ACCOUNT_RATE_LIMIT: str = "10/minute"
    EMAIL_RATE_LIMIT: str = "3/hour"
    SCRAMBLE_RATE_LIMIT: str = "60/minute"
    TOURNAMENT_RATE_LIMIT: str = "60/minute"
    # Comma-separated CIDRs / hosts we trust to set X-Forwarded-For.
    TRUSTED_PROXIES: str = "127.0.0.1,::1"

    # --- Scramble tokens ---
    # Generous solo-window TTL for the signed GET /scramble -> POST /solves
    # token; a solve started long after fetch may 422 (user re-scrambles).
    SCRAMBLE_TOKEN_TTL: int = 3600

    # --- Weekly tournament attempts ---
    # Window from POST .../attempt/start to a still-accepted
    # POST .../attempt/submit; a submit arriving later is forced to "dnf".
    TOURNAMENT_ATTEMPT_WINDOW_SECONDS: int = 600
    # GET /tournament/current/standings `limit` query param: default when
    # omitted, hard ceiling it is always clamped to.
    TOURNAMENT_STANDINGS_LIMIT_DEFAULT: int = 50
    TOURNAMENT_STANDINGS_LIMIT_MAX: int = 200

    # --- Daily scramble (parallel vertical to the weekly tournament) ---
    # Window from POST /daily/.../attempt/start to a still-accepted
    # POST /daily/.../attempt/submit; a submit arriving later is forced to "dnf".
    DAILY_ATTEMPT_WINDOW_SECONDS: int = 600
    # GET /daily/current/board `limit` query param: default when omitted,
    # hard ceiling it is always clamped to.
    DAILY_BOARD_LIMIT_DEFAULT: int = 50
    DAILY_BOARD_LIMIT_MAX: int = 200
    DAILY_RATE_LIMIT: str = "60/minute"
    # Запись сборок: authed-роут, но без лимита бот мог бы накачивать историю,
    # `best_single_ms` и бейджи. Порог заведомо выше человеческого темпа.
    SOLVE_RATE_LIMIT: str = "30/minute"

    # --- Link-invite duels (Этап 4) ---
    DUEL_RATE_LIMIT: str = "30/minute"
    # Separate CORS-like allowlist for the WS handshake's Origin header — a WS
    # upgrade isn't covered by CORSMiddleware (CSWSH; see app.routers.duel).
    DUEL_ALLOWED_WS_ORIGINS: str = "http://localhost:5173,http://127.0.0.1:5173"
    # How long an invite link (POST /duel/rooms's invite_token) stays joinable.
    DUEL_INVITE_TTL_SECONDS: int = 86400
    # TTL of the WS session/reconnect token (app.services.duel_token) — generous,
    # covers a full duel plus reconnects (mirrors SCRAMBLE_TOKEN_TTL's rationale).
    DUEL_SESSION_TOKEN_TTL_SECONDS: int = 7200
    # Max time between the WS `start` broadcast and both players sending `ready`
    # before the room is force-finalized (whoever isn't ready -> dnf).
    DUEL_PREP_TIMEOUT_SECONDS: int = 180
    # Max time in the solving phase before a still-unsubmitted player is forced dnf.
    DUEL_SOLVE_TIMEOUT_SECONDS: int = 600
    # Grace window to reconnect after a disconnect before/at/during prep — past it
    # the room is abandoned. NOT used once solving has started (see duel_manager).
    DUEL_DISCONNECT_GRACE_SECONDS: int = 60
    DUEL_HEARTBEAT_INTERVAL_SECONDS: int = 5
    DUEL_HEARTBEAT_TIMEOUT_SECONDS: int = 15
    DUEL_COUNTDOWN_SECONDS: int = 3
    # Pause between a game's finish and the next rematch's creation beyond
    # which the running "series" score (GET /duel/rooms/{id}/series) treats
    # the rematch as the start of a NEW series rather than a continuation of
    # the current one — see app.services.duel.series_chain.
    DUEL_SERIES_GAP_SECONDS: int = 3600

    # --- Friends (mutual, added by public_handle only) ---
    # Ordinary per-IP throttle applied to every /friends/* route.
    FRIENDS_RATE_LIMIT: str = "60/minute"
    # Additional per-CALLING-USER throttle on POST /friends/requests only
    # (app.services.ratelimit.user_rate_limit) — an IP-keyed limit alone is
    # not a defense against probing which public_handles exist, since
    # rotating IP (or a second worker) resets it; this is keyed by user.id.
    FRIEND_REQUEST_RATE_LIMIT: str = "10/minute"

    # --- Process topology ---
    # Duel rooms live in one process's memory (app.services.duel_manager) — no
    # Redis/shared-state backing this MVP brick. main.py's startup lifespan
    # refuses to boot when this is > 1 (see that module).
    WEB_CONCURRENCY: int = 1

    @property
    def cors_origins(self) -> list[str]:
        return [origin.strip() for origin in self.CORS_ORIGINS.split(",") if origin.strip()]

    @property
    def duel_allowed_ws_origins(self) -> list[str]:
        return [
            origin.strip() for origin in self.DUEL_ALLOWED_WS_ORIGINS.split(",") if origin.strip()
        ]

    @property
    def is_local(self) -> bool:
        return self.APP_ENV == "local"

    @property
    def cookie_secure(self) -> bool:
        """Cookies are `Secure` everywhere except local dev (which is plain http)."""
        return not self.is_local

    @property
    def trusted_proxies(self) -> list[str]:
        return [p.strip() for p in self.TRUSTED_PROXIES.split(",") if p.strip()]

    @model_validator(mode="after")
    def _reject_placeholder_secrets(self) -> "Settings":
        """Secrets must be real (not the committed placeholders) in EVERY env.

        Fail-closed regardless of APP_ENV: a prod deploy that forgets to set
        APP_ENV must not silently boot with the `.env.example` placeholders.
        """
        for name in ("SECRET", "RESET_VERIFY_SECRET", "SCRAMBLE_SIGN_SECRET", "DUEL_SIGN_SECRET"):
            value: str = getattr(self, name)
            lowered = value.lower()
            if any(fragment in lowered for fragment in _PLACEHOLDER_FRAGMENTS):
                raise ValueError(
                    f"{name} is set to a placeholder value; refusing to boot. "
                    "Generate one with "
                    "`python -c 'import secrets; print(secrets.token_urlsafe(48))'`."
                )
        return self


@lru_cache
def get_settings() -> Settings:
    return Settings()
