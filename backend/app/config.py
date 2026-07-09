from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Application settings, loaded from environment / `.env`."""

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    DATABASE_URL: str = "postgresql+asyncpg://cubr:cubr@localhost:5432/cubr"
    CORS_ORIGINS: str = "http://localhost:5173,http://127.0.0.1:5173"
    APP_ENV: str = "local"
    SECRET: str = "change-me-in-2.2-auth-stage"

    @property
    def cors_origins(self) -> list[str]:
        return [origin.strip() for origin in self.CORS_ORIGINS.split(",") if origin.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
