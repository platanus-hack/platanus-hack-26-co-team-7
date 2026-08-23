"""Automatic SCHEDULED AI report delivery for the latest open event.

Lives inside the ``ai_reports`` module (no new module — keeps the structure
rule in openspec/architecture.md). Triggers (EMSC/SGC) only open the
``events`` row through the shared database; this scheduler observes that row
via ``core/events.py::get_latest_open_event`` and owns the delivery cadence:
the first report as soon as the event has at least one aggregated cell
(``received_cells``), then one every ``ai_report_every_minutes`` during the
first ``ai_report_window_hours`` after ``occurred_at`` — stopping once the
event closes or the window elapses.
"""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from app.core.config import Settings, settings
from app.core.events import get_latest_open_event
from app.core.ws import ConnectionManager, manager
from app.models.analytics import Report, ReportSource
from app.modules.ai_reports.generator import generate_report

logger = logging.getLogger(__name__)


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _last_report_at(session: Session, event_id: str) -> datetime | None:
    """``generated_at`` of the most recent report for an event, or None."""
    return session.execute(
        select(Report.generated_at)
        .where(Report.event_id == event_id)
        .order_by(Report.generated_at.desc())
        .limit(1)
    ).scalar_one_or_none()


def should_generate_now(
    session: Session,
    *,
    st: Settings,
) -> tuple[bool, str]:
    """Decide whether this tick should emit a SCHEDULED report.

    Returns ``(run, reason)``. ``run`` is True when the latest open event is
    inside its delivery window and — for repeats — at least
    ``ai_report_every_minutes`` elapsed since that event's last report. The
    first report is attempted as soon as the event has any aggregated cell
    (the generator returns None until then, so the loop keeps retrying).
    """
    cadence = timedelta(minutes=st.ai_report_every_minutes)
    window = timedelta(hours=st.ai_report_window_hours)

    event = get_latest_open_event(session)
    if event is None:
        return False, "no_open_event"

    elapsed = max(_now() - event.occurred_at, timedelta(0))
    if elapsed > window:
        return False, "window_elapsed"

    last = _last_report_at(session, event.event_id)
    if last is None:
        # First report: attempt as soon as there is any aggregated cell.
        return True, "first_report"
    if _now() - last >= cadence:
        return True, "cadence_elapsed"
    return False, "within_cadence"


async def run_report_scheduler(
    session_factory: sessionmaker[Session],
    *,
    st: Settings | None = None,
    ws_manager: ConnectionManager | None = None,
) -> None:
    """Run the delivery scheduler until cancelled (one report per tick max).

    Wired into the FastAPI lifespan via ``create_task``; only started when
    ``settings.ai_reports_enabled`` is truthy, so demo startup stays free of
    side effects. A failed report never crashes the loop.
    """
    st = st or settings
    ws_manager = ws_manager or manager
    interval = timedelta(seconds=st.ai_report_scheduler_interval_s)
    while True:
        try:
            session = session_factory()
            try:
                run, reason = should_generate_now(session, st=st)
            finally:
                session.close()

            if run:
                report = await generate_report(
                    session_factory, ws_manager, source=ReportSource.SCHEDULED
                )
                if report is None:
                    logger.info(
                        "ai_reports scheduler: tick skipped (%s)", reason
                    )
                else:
                    logger.info(
                        "ai_reports scheduler: SCHEDULED report %s for event %s",
                        report.id,
                        report.event_id,
                    )
        except asyncio.CancelledError:
            logger.info("ai_reports scheduler cancelled")
            raise
        except Exception:  # noqa: BLE001 - never crash the app
            logger.exception("ai_reports scheduler tick error")
        await asyncio.sleep(interval.total_seconds())