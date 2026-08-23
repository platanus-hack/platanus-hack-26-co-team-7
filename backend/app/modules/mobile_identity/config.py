"""Configuration isolated to the private mobile identity module."""

from __future__ import annotations

import os
from dataclasses import dataclass


def _require_secret(name: str) -> str:
    value = os.environ.get(name, "")
    if len(value) < 32:
        raise RuntimeError(f"{name} must be set to at least 32 characters.")
    return value


def _positive_int(name: str, default: int) -> int:
    try:
        value = int(os.environ.get(name, str(default)))
    except ValueError as error:
        raise RuntimeError(f"{name} must be a positive integer.") from error
    if value <= 0:
        raise RuntimeError(f"{name} must be a positive integer.")
    return value


def _enabled(name: str) -> bool:
    return os.environ.get(name, "").strip().casefold() == "true"


@dataclass(frozen=True)
class MobileIdentitySettings:
    jwt_secret: str
    refresh_token_pepper: str
    access_token_ttl_seconds: int
    refresh_token_ttl_seconds: int
    demo_trigger_enabled: bool


settings = MobileIdentitySettings(
    jwt_secret=_require_secret("AUTH_JWT_SECRET"),
    refresh_token_pepper=_require_secret("AUTH_REFRESH_TOKEN_PEPPER"),
    access_token_ttl_seconds=_positive_int("AUTH_ACCESS_TOKEN_TTL_SECONDS", 900),
    refresh_token_ttl_seconds=_positive_int("AUTH_REFRESH_TOKEN_TTL_SECONDS", 2_592_000),
    demo_trigger_enabled=_enabled("DEMO_TRIGGER_ENABLED"),
)
