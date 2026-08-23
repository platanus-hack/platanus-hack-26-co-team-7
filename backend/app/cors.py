"""Cross-cutting CORS configuration for browser clients."""

from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.core.config import settings

_ALLOWED_METHODS = ("GET", "POST", "PUT", "OPTIONS")
_ALLOWED_HEADERS = ("Authorization", "Content-Type")


def configure_cors(app: FastAPI) -> None:
    """Install the minimal CORS policy for web and browser-based mobile development."""
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=False,
        allow_methods=_ALLOWED_METHODS,
        allow_headers=_ALLOWED_HEADERS,
    )
