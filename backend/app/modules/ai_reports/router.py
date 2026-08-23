"""Private HTTP entry point for manual AI report generation.

Public dashboard routes remain read-only. Internal callers invoke
``POST /internal/v1/reports/generate`` with ``X-Internal-API-Key``; application
code should call ``generate_report`` directly when an HTTP boundary is not needed.
"""

from __future__ import annotations

import secrets

from fastapi import APIRouter, Depends, Header, HTTPException

from app.core.config import settings
from app.core.database import SessionLocal
from app.core.ws import manager
from app.models.analytics import ReportSource
from app.modules.ai_reports.generator import generate_report
from app.modules.dashboard.schemas import ReportOut

router = APIRouter(prefix="/internal/v1", include_in_schema=False)


def require_internal_reports_key(
    x_internal_api_key: str | None = Header(default=None),
) -> None:
    """Authorize the least-privilege key for report generation.

    An unset key disables this endpoint, preventing accidental public exposure
    in environments that have not explicitly configured an internal caller.
    """
    expected_key = settings.internal_reports_api_key
    if not expected_key or not x_internal_api_key or not secrets.compare_digest(
        x_internal_api_key, expected_key
    ):
        raise HTTPException(status_code=403, detail="Internal access required.")


@router.post("/reports/generate", response_model=ReportOut)
async def post_generate_report(
    _: None = Depends(require_internal_reports_key),
) -> ReportOut:
    """Generate one MANUAL report for the latest open event.

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
