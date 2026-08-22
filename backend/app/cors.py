"""Cross-cutting CORS configuration for browser clients."""

from __future__ import annotations

import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

CORS_ALLOWED_ORIGINS_ENV = "CORS_ALLOWED_ORIGINS"
_LOCAL_DEVELOPMENT_ORIGINS = (
    "http://localhost:5173",
    "http://localhost:8081",
)
_ALLOWED_METHODS = ("GET", "POST", "PUT", "OPTIONS")
_ALLOWED_HEADERS = ("Authorization", "Content-Type")


def get_allowed_origins(raw: str | None = None) -> tuple[str, ...]:
    """Read and validate the comma-separated browser-origin allowlist."""
    configured_origins = raw if raw is not None else os.environ.get(CORS_ALLOWED_ORIGINS_ENV)
    if not configured_origins or not configured_origins.strip():
        return _LOCAL_DEVELOPMENT_ORIGINS

    origins = tuple(
        dict.fromkeys(origin.strip() for origin in configured_origins.split(",") if origin.strip())
    )
    if "*" in origins:
        raise RuntimeError(f"{CORS_ALLOWED_ORIGINS_ENV} must not include the wildcard origin '*'.")
    return origins


def configure_cors(app: FastAPI) -> None:
    """Install the minimal CORS policy for web and browser-based mobile development."""
    app.add_middleware(
        CORSMiddleware,
        allow_origins=get_allowed_origins(),
        allow_credentials=False,
        allow_methods=_ALLOWED_METHODS,
        allow_headers=_ALLOWED_HEADERS,
    )
