"""Application settings.

Reads the database connection string from the ``DATABASE_URL`` environment
variable with a sane local development default (PostgreSQL + psycopg driver,
per openspec/architecture.md Componente 3).
"""

from __future__ import annotations

import os

from dataclasses import dataclass

DEFAULT_DATABASE_URL = "postgresql+psycopg://ziro:ziro@localhost:5432/ziro"

# Comma-separated list of allowed CORS origins for the static web dashboard
# (openspec/changes/dashboard-web/design.md D5). Wildcard "*" with
# credentials is forbidden by the public-api-readonly spec.
DEFAULT_CORS_ORIGINS = ["http://localhost:5173"]


def _parse_cors_origins(raw: str | None) -> list[str]:
    """Parse BACKEND_CORS_ORIGINS ("origin1,origin2") into a clean list."""
    if not raw:
        return list(DEFAULT_CORS_ORIGINS)
    return [origin.strip() for origin in raw.split(",") if origin.strip()]


@dataclass(frozen=True)
class Settings:
    database_url: str = DEFAULT_DATABASE_URL
    cors_origins: tuple[str, ...] = tuple(DEFAULT_CORS_ORIGINS)


settings = Settings(
    database_url=os.environ.get("DATABASE_URL", DEFAULT_DATABASE_URL),
    cors_origins=tuple(_parse_cors_origins(os.environ.get("BACKEND_CORS_ORIGINS"))),
)
