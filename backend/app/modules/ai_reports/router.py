"""AI reports module router: the only write action exposed on this surface.

``POST /api/v1/reports/generate`` triggers one MANUAL report generation
(dashboard button). Reading reports back is dashboard-module territory
(``GET /api/v1/reports``) since it's plain DB consumption, not AI work.
"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException

from app.core.database import SessionLocal
from app.core.ws import manager
from app.models.analytics import ReportSource
from app.modules.ai_reports.generator import generate_report
from app.modules.dashboard.schemas import ReportOut

router = APIRouter(prefix="/api/v1", tags=["ai_reports"])


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
