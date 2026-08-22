"""GET /api/v1/reports — AI reports of the latest open event.

Implements openspec/changes/dashboard-web/specs/public-api-readonly
(Requirement: Endpoint GET /api/v1/reports). Same latest-open-event default
rule as the heatmap; ordered by ``generated_at`` DESC with ``limit``
defaulting to 50. ``content`` (JSONB) is passed through verbatim, never
interpreted or transformed.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database import SessionLocal, get_session
from app.models.analytics import Report, ReportSource
from app.models.event import Event
from app.routers.heatmap import get_latest_open_event
from app.schemas.dashboard import ReportOut, ReportsResponse
from app.services.report_generator import generate_report
from app.ws import manager

router = APIRouter(prefix="/api/v1", tags=["reports"])


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


@router.post("/reports/generate", response_model=ReportOut)
async def post_generate_report() -> ReportOut:
    """Generate one MANUAL report for the latest open event (dashboard button).

    200 with the serialized report; typed 409 ``NO_OPEN_EVENT`` when there is
    no open event or it has no aggregated cells yet.
    """
    report = await generate_report(
        SessionLocal, manager, source=ReportSource.MANUAL
    )
    if report is None:
        raise HTTPException(
            status_code=409,
            detail={
                "code": "NO_OPEN_EVENT",
                "message": "No open event with aggregated cells to report on.",
            },
        )
    return ReportOut(
        id=report.id,
        event_id=report.event_id,
        source=report.source.value,
        generated_at=report.generated_at,
        content=report.content,
    )
