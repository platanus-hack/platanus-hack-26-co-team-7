"""Public dashboard response contracts (openspec/changes/dashboard-web).

Readonly surface consumed by the static web dashboard. Privacy invariant:
no raw coordinates, no person identifiers (``sid``), no individual telegram
payloads ever appear in these models. The report ``content`` field is passed
through verbatim (design D2) — the API never interprets it.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from pydantic import BaseModel


class Centroid(BaseModel):
    """Cell centroid derived server-side from ``h3_index`` (design D6)."""

    lat: float
    lng: float


class HeatmapCell(BaseModel):
    h3_index: str
    intensity: float
    person_count: int
    centroid: Centroid
    window_start: datetime


class HeatmapResponse(BaseModel):
    event_id: str | None = None
    cells: list[HeatmapCell] = []


class ReportOut(BaseModel):
    id: uuid.UUID
    event_id: str
    source: str
    generated_at: datetime
    # JSONB passed through as-is; schema v1 documented in design D2.
    content: dict[str, Any]


class ReportsResponse(BaseModel):
    event_id: str | None = None
    reports: list[ReportOut] = []


class PersonMarker(BaseModel):
    user_id: str
    status: str
    lat: float
    lng: float
    updated_at: str


class PersonsResponse(BaseModel):
    event_id: str | None = None
    persons: list[PersonMarker] = []


class ErrorResponse(BaseModel):
    """Typed error body, e.g. 404 ``EVENT_NOT_FOUND``."""

    code: str
    message: str
