"""Deterministic SQL snapshot of the latest open event.

Feeds the AI report pipeline (openspec/architecture.md, "Reportes IA"):
the LLM only narrates these SQL-computed aggregates — it never computes
figures. Same latest-open-event rule as ``routers/heatmap.py``:

- Latest open event: ``closed_at IS NULL ORDER BY occurred_at DESC LIMIT 1``.
- Cells: GROUP BY h3_index with SUM(person_count), MAX(intensity),
  MAX(window_start); ordered by SUM(person_count) DESC, top 12 kept.
- Totals cover ALL cells (not just the top 12).
- Previous report figures included when available so the narrative can
  compare against the last emitted report.
"""

from __future__ import annotations

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.events import get_latest_open_event
from app.models.analytics import ReceivedCell, Report

_TOP_CELLS = 12


def build_snapshot(session: Session) -> dict | None:
    """Aggregated snapshot dict for the latest open event.

    Returns ``None`` when there is no open event or the event has no cells
    (nothing to narrate — caller decides what to do).
    """
    event = get_latest_open_event(session)
    if event is None:
        return None

    rows = session.execute(
        select(
            ReceivedCell.h3_index,
            func.sum(ReceivedCell.person_count).label("person_count"),
            func.max(ReceivedCell.intensity).label("intensity"),
            func.max(ReceivedCell.window_start).label("window_start"),
        )
        .where(ReceivedCell.event_id == event.event_id)
        .group_by(ReceivedCell.h3_index)
        .order_by(func.sum(ReceivedCell.person_count).desc())
    ).all()

    if not rows:
        return None

    cells = [
        {
            "h3_index": h3_index,
            "person_count": int(person_count),
            "intensity": float(intensity),
            "window_start": window_start.isoformat(),
        }
        for h3_index, person_count, intensity, window_start in rows[:_TOP_CELLS]
    ]

    previous = session.execute(
        select(Report)
        .where(Report.event_id == event.event_id)
        .order_by(Report.generated_at.desc())
        .limit(1)
    ).scalar_one_or_none()

    figures = None
    if previous is not None and isinstance(previous.content, dict):
        raw_figures = previous.content.get("figures")
        if isinstance(raw_figures, dict):
            figures = raw_figures

    return {
        "event_id": event.event_id,
        "totals": {
            "total_persons": int(sum(row[1] for row in rows)),
            "active_cells": len(rows),
        },
        "cells": cells,
        "previous_report_figures": figures,
    }
