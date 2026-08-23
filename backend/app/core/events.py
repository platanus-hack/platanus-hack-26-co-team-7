"""Shared ``events`` lookup used by more than one module.

Extracted from the dashboard module so ``ai_reports`` does not depend on
``modules.dashboard`` internals (openspec/architecture.md: modules share the
DB, never each other's code across module boundaries).
"""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.event import Event


def get_latest_open_event(session: Session) -> Event | None:
    """Latest open event or None when every event is closed/none exists."""
    return session.execute(
        select(Event)
        .where(Event.closed_at.is_(None))
        .order_by(Event.occurred_at.desc())
        .limit(1)
    ).scalar_one_or_none()
