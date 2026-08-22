"""Application settings.

Loads ``DATABASE_URL`` and ``BACKEND_CORS_ORIGINS`` exclusively from
environment variables / ``backend/.env`` (python-dotenv, never committed).
Hardcoded defaults are forbidden — missing ``DATABASE_URL`` fails fast.
Only PostgreSQL URLs are accepted (design: no SQLite fallback at runtime).
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

# Load backend/.env if present. Kept optional at import time so tests that
# inject env vars without dotenv still work; python-dotenv is a runtime
# dependency (see pyproject.toml).
try:
    from dotenv import load_dotenv  # type: ignore[import-untyped]

    load_dotenv(Path(__file__).resolve().parents[1] / ".env", override=False)
except ModuleNotFoundError:  # pragma: no cover - only during bare installs
    pass

# Comma-separated list of allowed CORS origins for the static web dashboard
# (openspec/changes/dashboard-web/design.md D5). Wildcard "*" with
# credentials is forbidden by the public-api-readonly spec.
_DEFAULT_CORS_ORIGINS = ("http://localhost:5173",)


def _parse_cors_origins(raw: str | None) -> tuple[str, ...]:
    """Parse BACKEND_CORS_ORIGINS ("origin1,origin2") into a clean tuple."""
    if not raw:
        return _DEFAULT_CORS_ORIGINS
    parsed = tuple(origin.strip() for origin in raw.split(",") if origin.strip())
    return parsed if parsed else _DEFAULT_CORS_ORIGINS


def _require_database_url() -> str:
    raw = os.environ.get("DATABASE_URL")
    if not raw or not raw.strip():
        raise RuntimeError(
            "DATABASE_URL is not set. Create backend/.env from backend/.env.example "
            "and set e.g. DATABASE_URL=postgresql+psycopg://replica:replica@localhost:5432/replica"
        )
    url = raw.strip()
    # Runtime only supports PostgreSQL (psycopg driver). The "+psycopg" driver
    # suffix is required so SQLAlchemy picks the correct dialect.
    if not url.startswith("postgresql+psycopg://"):
        raise RuntimeError(
            "DATABASE_URL must use the PostgreSQL psycopg driver, "
            f"e.g. postgresql+psycopg://user:pass@host/db — got: {url[:32]}..."
        )
    return url


@dataclass(frozen=True)
class Settings:
    database_url: str
    cors_origins: tuple[str, ...]


settings = Settings(
    database_url=_require_database_url(),
    cors_origins=_parse_cors_origins(os.environ.get("BACKEND_CORS_ORIGINS")),
)
