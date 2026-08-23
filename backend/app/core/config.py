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

    load_dotenv(Path(__file__).resolve().parents[2] / ".env", override=False)
except ModuleNotFoundError:  # pragma: no cover - only during bare installs
    pass

# Comma-separated list of allowed CORS origins for the static web dashboard
# (openspec/changes/dashboard-web/design.md D5). Wildcard "*" with
# credentials is forbidden by the public-api-readonly spec.
_DEFAULT_CORS_ORIGINS = (
    "http://localhost:5173",
    "http://localhost:8081",
    "https://replica-web.onrender.com",
)


def _parse_cors_origins(raw: str | None) -> tuple[str, ...]:
    """Parse BACKEND_CORS_ORIGINS ("origin1,origin2") into a clean tuple."""
    if not raw:
        return _DEFAULT_CORS_ORIGINS
    parsed = tuple(dict.fromkeys(origin.strip() for origin in raw.split(",") if origin.strip()))
    if "*" in parsed:
        raise RuntimeError("BACKEND_CORS_ORIGINS must not include the wildcard origin '*'.")
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


def _env_int(default: int, *names: str) -> int:
    """Parse an env var as an int, falling back to ``default`` when unset."""
    raw = _env_or("", *names)
    try:
        return int(raw)
    except (TypeError, ValueError):
        return default


def _normalize_llm_base_url(raw: str) -> str:
    """Accept either a base URL or a full chat-completions URL.

    Providers publish the full endpoint (HuggingFace's router advertises
    ``.../v1/chat/completions``) while ai_reports/generator.py appends
    ``/chat/completions`` itself. Trimming the suffix here means either form
    can be pasted into .env without producing a doubled path.
    """
    url = raw.strip().rstrip("/")
    suffix = "/chat/completions"
    if url.endswith(suffix):
        url = url[: -len(suffix)]
    return url


@dataclass(frozen=True)
class Settings:
    database_url: str
    cors_origins: tuple[str, ...]
    # AI reports (openspec/architecture.md "Reportes IA"). Empty llm_api_key
    # disables LLM narration -> deterministic fallback template is used.
    llm_api_key: str
    llm_model: str
    llm_base_url: str
    llm_max_tokens: int
    llm_timeout_s: float
    # HTTP report generation is an internal operation. An empty value disables
    # the endpoint rather than allowing unauthenticated fallback access.
    internal_reports_api_key: str
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
    # SGC (Servicio Geológico Colombiano) earthquake trigger poller
    # (trigger_sgc module). Poller must NOT fetch unless sgc_enabled is truthy,
    # so the default keeps tests/demo free of any network dependency on
    # archive.sgc.gov.co. Same Colombia box (+ a lower 4.5 mag floor) as EMSC
    # for borough consistency; both sources may run and dedup by their own ids.
    sgc_enabled: bool
    sgc_url: str
    sgc_poll_interval_s: int
    sgc_min_mag: float
    sgc_min_lat: float
    sgc_max_lat: float
    sgc_min_lon: float
    sgc_max_lon: float
    # Automatic SCHEDULED report delivery (ai_reports.scheduler). Disabled by
    # default so demo startup stays free of side effects; when enabled, the
    # first report is delivered as soon as the open event has aggregated cells
    # and then one every ai_report_every_minutes during the first
    # ai_report_window_hours after occurred_at.
    ai_reports_enabled: bool
    ai_report_scheduler_interval_s: int
    ai_report_every_minutes: int
    ai_report_window_hours: int
    # H3 spatial aggregation of ingested telegrams (gateway_sync.aggregator).
    # Disabled by default so demo startup stays side-effect-free; when enabled
    # it rebuilds received_cells for the latest open event each tick.
    aggregator_enabled: bool
    aggregator_interval_s: int
    # Public, unauthenticated demo trigger used by the web dashboard button to
    # stand in for the EMSC/SGC pollers during a live presentation. It WRITES
    # (rebuilds the demo event), so it stays off unless explicitly enabled and
    # must never be turned on in a real deployment.
    demo_web_trigger_enabled: bool


settings = Settings(
    database_url=_require_database_url(),
    cors_origins=_parse_cors_origins(os.environ.get("BACKEND_CORS_ORIGINS")),
    # HUGGINGFACE_* are accepted as aliases so a provider's own env block can be
    # pasted into .env unchanged; LLM_* still wins when both are present.
    llm_api_key=_env_or("", "LLM_API_KEY", "HUGGINGFACE_API_KEY"),
    llm_model=_env_or("gpt-4o-mini", "LLM_MODEL", "HUGGINGFACE_MODEL"),
    llm_base_url=_normalize_llm_base_url(
        _env_or("https://api.openai.com/v1", "LLM_BASE_URL", "HUGGINGFACE_API_URL")
    ),
    llm_max_tokens=_env_int(1024, "LLM_MAX_TOKENS", "HUGGINGFACE_MAX_TOKENS"),
    llm_timeout_s=_env_float(30_000.0, "LLM_TIMEOUT_MS", "HUGGINGFACE_TIMEOUT_MS") / 1000.0,
    internal_reports_api_key=os.environ.get("INTERNAL_REPORTS_API_KEY", "").strip(),
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
    sgc_enabled=_env_bool(False, "SGC_ENABLED"),
    sgc_url=_env_or(
        "https://archive.sgc.gov.co/feed/v1.0.1/summary/five_days_all.json",
        "SGC_URL",
    ),
    sgc_poll_interval_s=_env_int(60, "SGC_POLL_INTERVAL_S"),
    sgc_min_mag=_env_float(4.5, "SGC_MIN_MAG"),
    sgc_min_lat=_env_float(0.0, "SGC_MIN_LAT"),
    sgc_max_lat=_env_float(14.0, "SGC_MAX_LAT"),
    sgc_min_lon=_env_float(-80.0, "SGC_MIN_LON"),
    sgc_max_lon=_env_float(-66.0, "SGC_MAX_LON"),
    ai_reports_enabled=_env_bool(False, "AI_REPORTS_ENABLED"),
    ai_report_scheduler_interval_s=_env_int(15, "AI_REPORT_SCHEDULER_INTERVAL_S"),
    ai_report_every_minutes=_env_int(30, "AI_REPORT_EVERY_MINUTES"),
    ai_report_window_hours=_env_int(6, "AI_REPORT_WINDOW_HOURS"),
    aggregator_enabled=_env_bool(False, "AGGREGATOR_ENABLED"),
    aggregator_interval_s=_env_int(30, "AGGREGATOR_INTERVAL_S"),
    demo_web_trigger_enabled=_env_bool(False, "DEMO_WEB_TRIGGER_ENABLED"),
)
