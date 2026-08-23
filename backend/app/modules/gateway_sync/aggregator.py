"""H3 spatial aggregator (openspec/architecture.md, "Agregador espacial").

Lives inside the ``gateway_sync`` ingestion module (no new module — the data it
consumes is produced here). Reads the telegrams this module already ingests
(``GatewayTelegramRecord``) and writes the shared aggregation cache
``received_cells`` consumed by both the dashboard heatmap and the AI report
snapshot.

Semantics (respect the analytics model):
- A "person in danger" is one whose LATEST telegram for an event has status
  EMERGENCY or NEED_HELP. Only the most recent record per (event, user) counts,
  at its most recent coordinates.
- person_count per cell = COUNT(DISTINCT user_id) in danger.
- intensity is deterministic and >= 0: f(count, recency, hop).
- The cache is REBUILT each tick (consumers SUM person_count, so accumulating
  historical windows would inflate totals): the event's received_cells are
  replaced with the current aligned window (idempotent, bounded).
"""

from __future__ import annotations

import asyncio
import logging
import math
from datetime import datetime, timedelta, timezone

import h3
from sqlalchemy import delete, select
from sqlalchemy.orm import Session, sessionmaker

from app.core.config import Settings, settings
from app.core.constants import H3_CELL_RESOLUTION
from app.core.events import get_latest_open_event
from app.core.ws import ConnectionManager, manager
from app.models.analytics import ReceivedCell
from app.modules.gateway_sync.models import GatewayTelegramRecord, PersonStatus

logger = logging.getLogger(__name__)

# Aligned window length for one received_cells bucket (matches demo seed).
_WINDOW_MINUTES = 10
# Recency half-life: intensity decays as a cell's newest in-danger telegram ages.
_RECENCY_HALF_LIFE_SECONDS = 30 * 60  # 30 min
# Per-hop mesh-depth penalty applied from the cell's average hop count.
_HOP_PENALTY_PER_HOP = 0.1
_HOP_FACTOR_FLOOR = 0.5

_IN_DANGER_STATUSES = (PersonStatus.EMERGENCY, PersonStatus.NEED_HELP)


def _window_bucket(now: datetime, minutes: int = _WINDOW_MINUTES) -> tuple[datetime, datetime]:
    """Align ``now`` to a fixed ``minutes`` edge so a tick is idempotent."""
    aligned = now.replace(second=0, microsecond=0)
    aligned -= timedelta(minutes=aligned.minute % minutes)
    return aligned, aligned + timedelta(minutes=minutes)


def _cell_intensity(person_count: int, newest_ts: datetime, avg_hop: float, now: datetime) -> float:
    """Deterministic intensity: ``count * recency * hop``, bounded >= 0."""
    age_seconds = max((now - newest_ts).total_seconds(), 0.0)
    recency = math.exp(-age_seconds / _RECENCY_HALF_LIFE_SECONDS)
    hop_factor = max(_HOP_FACTOR_FLOOR, 1.0 - _HOP_PENALTY_PER_HOP * avg_hop)
    return round(person_count * recency * hop_factor, 2)


def _aggregate_event(
    session: Session, event_id: str, window: datetime, window_end: datetime, now: datetime
) -> list[ReceivedCell]:
    """Compute the current-window H3 cells for one event from its telegrams."""
    rows = session.execute(
        select(GatewayTelegramRecord).where(
            GatewayTelegramRecord.event_id == event_id,
            GatewayTelegramRecord.status.in_(_IN_DANGER_STATUSES),
        )
    ).scalars()

    # Keep the most recent in-danger record per user (a person counts once, at
    # their most recent in-danger coordinates).
    latest_by_user: dict[str, GatewayTelegramRecord] = {}
    for rec in rows:
        cur = latest_by_user.get(rec.user_id)
        if cur is None or rec.origin_ts > cur.origin_ts:
            latest_by_user[rec.user_id] = rec

    by_cell: dict[str, list[GatewayTelegramRecord]] = {}
    for rec in latest_by_user.values():
        h3_index = h3.latlng_to_cell(rec.lat, rec.lng, H3_CELL_RESOLUTION)
        by_cell.setdefault(h3_index, []).append(rec)

    cells: list[ReceivedCell] = []
    for h3_index, records in by_cell.items():
        newest_ts = max(rec.origin_ts for rec in records)
        avg_hop = sum(rec.hop for rec in records) / len(records)
        cells.append(
            ReceivedCell(
                event_id=event_id,
                h3_index=h3_index,
                window_start=window,
                window_end=window_end,
                person_count=len(records),
                intensity=_cell_intensity(len(records), newest_ts, avg_hop, now),
            )
        )
    return cells


def aggregate_latest_open_event(session: Session, *, st: Settings) -> dict[str, int]:
    """Rebuild the current window's cells for the latest open event.

    Returns ``{event_id: cells_written}`` (empty when there is no open event).
    Replaces the event's received_cells so SUM-based consumers see a live count.
    """
    event = get_latest_open_event(session)
    if event is None:
        return {}

    now = datetime.now(timezone.utc)
    window, window_end = _window_bucket(now)
    session.execute(delete(ReceivedCell).where(ReceivedCell.event_id == event.event_id))
    cells = _aggregate_event(session, event.event_id, window, window_end, now)
    if cells:
        session.add_all(cells)
    session.commit()
    return {event.event_id: len(cells)}


async def run_aggregator(
    session_factory: sessionmaker[Session],
    *,
    st: Settings | None = None,
    ws_manager: ConnectionManager | None = None,
) -> None:
    """Run the spatial aggregator until cancelled (one pass per tick max).

    Wired into the FastAPI lifespan via ``create_task``; only started when
    ``settings.aggregator_enabled`` is truthy, so demo startup stays
    side-effect-free. A failed tick never crashes the app.
    """
    st = st or settings
    ws_manager = ws_manager or manager
    interval = timedelta(seconds=st.aggregator_interval_s)
    while True:
        try:
            session = session_factory()
            try:
                summary = aggregate_latest_open_event(session, st=st)
            finally:
                session.close()

            for event_id, cells_written in summary.items():
                if cells_written:
                    await ws_manager.broadcast_cells_updated(event_id)
                else:
                    logger.info("gateway_sync aggregator: no cells for event %s", event_id)
        except asyncio.CancelledError:
            logger.info("gateway_sync aggregator cancelled")
            raise
        except Exception:  # noqa: BLE001 - never crash the app
            logger.exception("gateway_sync aggregator tick error")
        await asyncio.sleep(interval.total_seconds())