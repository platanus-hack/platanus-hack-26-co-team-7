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


def _env_or(default: str, *names: str) -> str:
    """First non-empty env var among ``names`` or the hardcoded default."""
    for name in names:
        raw = os.environ.get(name)
        if raw and raw.strip():
            return raw.strip()
    return default


def _env_bool(default: bool, *names: str) -> bool:
    """Parse an env var as a boolean (accepts ``1/true/yes/on``)."""
    raw = os.environ.get(names[0]) if names else None
    if not raw or not raw.strip():
        return default
    return raw.strip().lower() in ("1", "true", "yes", "on")


def _env_float(default: float, *names: str) -> float:
    """Parse an env var as a float, falling back to ``default`` when unset."""
    raw = _env_or("", *names)
    try:
        return float(raw)
    except (TypeError, ValueError):
        return default


@dataclass(frozen=True)
class Settings:
    database_url: str
    cors_origins: tuple[str, ...]
    # AI reports (openspec/architecture.md "Reportes IA"). Empty llm_api_key
    # disables LLM narration -> deterministic fallback template is used.
    llm_api_key: str
    llm_model: str
    llm_base_url: str
    # Colombian open data (Socrata rgre-6ak4) department filter.
    gov_department: str
    # EMSC near-real-time earthquake trigger listener (trigger_emsc module).
    # Listener must NOT connect unless emsc_enabled is truthy, so the default
    # keeps tests/demo free of any network dependency on seismicportal.eu.
    emsc_enabled: bool
    emsc_url: str
    emsc_min_mag: float
    emsc_min_lat: float
    emsc_max_lat: float
    emsc_min_lon: float
    emsc_max_lon: float


settings = Settings(
    database_url=_require_database_url(),
    cors_origins=_parse_cors_origins(os.environ.get("BACKEND_CORS_ORIGINS")),
    llm_api_key=os.environ.get("LLM_API_KEY", ""),
    llm_model=_env_or("gpt-4o-mini", "LLM_MODEL"),
    llm_base_url=_env_or("https://api.openai.com/v1", "LLM_BASE_URL"),
    gov_department=_env_or("CUNDINAMARCA", "GOV_DEPARTMENT"),
    emsc_enabled=_env_bool(False, "EMSC_ENABLED"),
    emsc_url=_env_or(
        "wss://www.seismicportal.eu/standing_order/websocket", "EMSC_URL"
    ),
    emsc_min_mag=_env_float(5.0, "EMSC_MIN_MAG"),
    emsc_min_lat=_env_float(0.0, "EMSC_MIN_LAT"),
    emsc_max_lat=_env_float(14.0, "EMSC_MAX_LAT"),
    emsc_min_lon=_env_float(-80.0, "EMSC_MIN_LON"),
    emsc_max_lon=_env_float(-66.0, "EMSC_MAX_LON"),
)
