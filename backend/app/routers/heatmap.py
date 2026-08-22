"""GET /api/v1/heatmap — aggregated H3 cells of the latest open event.

Implements openspec/changes/dashboard-web/specs/public-api-readonly
(Requirement: Endpoint GET /api/v1/heatmap) and design D6:

- Without ``event_id``: use the latest open event
  (``closed_at IS NULL ORDER BY occurred_at DESC LIMIT 1``).
- No open event at all: 200 with an empty collection (cold start).
- Explicit unknown ``event_id``: typed 404 ``EVENT_NOT_FOUND``.
- Cells accumulate ALL windows of the event, one row per ``h3_index``
  (GROUP BY with SUM(telegram_count), MAX(intensity), MAX(window_start)).
  Intensity is read as-is (already precomputed upstream); never recomputed.
- Centroid derived server-side from the H3 cell only — a ~500 m cell center,
  never an individual position.
"""

from __future__ import annotations

import h3
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.database import get_session
from app.models.analytics import ReceivedCell
from app.models.event import Event
from app.schemas.dashboard import Centroid, HeatmapCell, HeatmapResponse

router = APIRouter(prefix="/api/v1", tags=["heatmap"])


def get_latest_open_event(session: Session) -> Event | None:
    """Latest open event or None when every event is closed/none exists."""
    return session.execute(
        select(Event)
        .where(Event.closed_at.is_(None))
        .order_by(Event.occurred_at.desc())
        .limit(1)
    ).scalar_one_or_none()


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
            func.sum(ReceivedCell.telegram_count).label("telegram_count"),
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
            telegram_count=int(telegram_count),
            centroid=_cell_centroid(h3_index),
            window_start=window_start,
        )
        for h3_index, telegram_count, intensity, window_start in rows
    ]
    return HeatmapResponse(event_id=event_id, cells=cells)


def _cell_centroid(h3_index: str) -> Centroid:
    lat, lng = h3.cell_to_latlng(h3_index)
    return Centroid(lat=lat, lng=lng)
