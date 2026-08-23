"""Dashboard module router: everything the public map/dashboard reads.

- ``GET /api/v1/heatmap`` — aggregated H3 cells of the latest open event.
- ``GET /api/v1/reports`` — AI reports of the latest open event.
- ``WS /ws`` — anonymous broadcast channel clients use to know when to refetch.

Implements openspec/changes/dashboard-web/specs/public-api-readonly, design
D6/D7:

- Without ``event_id``: use the latest open event
  (``closed_at IS NULL ORDER BY occurred_at DESC LIMIT 1``).
- No open event at all: 200 with an empty collection (cold start).
- Explicit unknown ``event_id``: typed 404 ``EVENT_NOT_FOUND``.
- Heatmap cells accumulate ALL windows of the event, one row per
  ``h3_index`` (GROUP BY with SUM(person_count), MAX(intensity),
  MAX(window_start)). Intensity is read as-is (already precomputed
  upstream); never recomputed. Centroid derived server-side from the H3
  cell only — a ~500 m cell center, never an individual position.
- ``reports`` ``content`` (JSONB) is passed through verbatim, never
  interpreted or transformed.
- The WS socket only receives typed notification messages and is kept open
  with a receive loop until the client disconnects; browser origins are
  validated against the configured CORS origins.
"""

from __future__ import annotations

import h3
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.database import get_session
from app.core.events import get_latest_open_event
from app.models.analytics import ReceivedCell, Report
from app.models.event import Event
from app.modules.gateway_sync.models import PersonState
from app.modules.dashboard.schemas import (
    Centroid,
    HeatmapCell,
    HeatmapResponse,
    PersonMarker,
    PersonsResponse,
    ReportOut,
    ReportsResponse,
)

router = APIRouter(prefix="/api/v1", tags=["dashboard"])


@router.get("/heatmap", response_model=HeatmapResponse)
def get_heatmap(
    event_id: str | None = Query(default=None),
    session: Session = Depends(get_session),
) -> HeatmapResponse:
    if event_id is None:
        latest = get_latest_open_event(session)
        if latest is None:
            # Cold start: no open event -> empty collection, not an error.
            return HeatmapResponse(cells=[])
        event_id = latest.event_id
    elif session.get(Event, event_id) is None:
        raise HTTPException(
            status_code=404,
            detail={
                "code": "EVENT_NOT_FOUND",
                "message": f"No event with id '{event_id}'.",
            },
        )

    rows = session.execute(
        select(
            ReceivedCell.h3_index,
            func.sum(ReceivedCell.person_count).label("person_count"),
            func.max(ReceivedCell.intensity).label("intensity"),
            func.max(ReceivedCell.window_start).label("window_start"),
        )
        .where(ReceivedCell.event_id == event_id)
        .group_by(ReceivedCell.h3_index)
    ).all()

    cells = [
        HeatmapCell(
            h3_index=h3_index,
            intensity=float(intensity),
            person_count=int(person_count),
            centroid=_cell_centroid(h3_index),
            window_start=window_start,
        )
        for h3_index, person_count, intensity, window_start in rows
    ]
    return HeatmapResponse(event_id=event_id, cells=cells)


def _cell_centroid(h3_index: str) -> Centroid:
    lat, lng = h3.cell_to_latlng(h3_index)
    return Centroid(lat=lat, lng=lng)


@router.get("/reports", response_model=ReportsResponse)
def get_reports(
    event_id: str | None = Query(default=None),
    limit: int = Query(default=50, ge=1, le=500),
    session: Session = Depends(get_session),
) -> ReportsResponse:
    if event_id is None:
        latest = get_latest_open_event(session)
        if latest is None:
            # Cold start: no open event -> empty collection, not an error.
            return ReportsResponse(reports=[])
        event_id = latest.event_id
    elif session.get(Event, event_id) is None:
        raise HTTPException(
            status_code=404,
            detail={
                "code": "EVENT_NOT_FOUND",
                "message": f"No event with id '{event_id}'.",
            },
        )

    reports = session.execute(
        select(Report)
        .where(Report.event_id == event_id)
        .order_by(Report.generated_at.desc())
        .limit(limit)
    ).scalars().all()

    return ReportsResponse(
        event_id=event_id,
        reports=[
            ReportOut(
                id=report.id,
                event_id=report.event_id,
                source=report.source.value,
                generated_at=report.generated_at,
                content=report.content,
            )
            for report in reports
        ],
    )


@router.get("/persons", response_model=PersonsResponse)
def get_persons(
    event_id: str | None = Query(default=None),
    session: Session = Depends(get_session),
) -> PersonsResponse:
    if event_id is None:
        latest = get_latest_open_event(session)
        if latest is None:
            return PersonsResponse(persons=[])
        event_id = latest.event_id
    elif session.get(Event, event_id) is None:
        raise HTTPException(
            status_code=404,
            detail={"code": "EVENT_NOT_FOUND", "message": f"No event with id '{event_id}'."},
        )

    states = session.execute(
        select(PersonState).where(
            PersonState.event_id == event_id,
            PersonState.emergency_lat.is_not(None),
            PersonState.emergency_lng.is_not(None),
        )
    ).scalars().all()

    return PersonsResponse(
        event_id=event_id,
        persons=[
            PersonMarker(
                user_id=s.user_id[:8],
                status=s.current_status.value,
                lat=s.emergency_lat,
                lng=s.emergency_lng,
                updated_at=s.updated_at.isoformat(),
            )
            for s in states
            if s.emergency_lat is not None and s.emergency_lng is not None
        ],
    )


# The realtime broadcast WS is mounted at the root path ("WS /ws") in
# app/main.py — NOT here, because this router applies a "/api/v1" prefix to
# every route. Defining it here would expose it at /api/v1/ws and break the
# documented contract (clients connect to /ws and get a 403).
# The origin policy lives in app/core/ws.py (ConnectionManager.origin_allowed).
