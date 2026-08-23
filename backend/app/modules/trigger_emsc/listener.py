"""EMSC standing-order WebSocket listener.

Connects to EMSC's near-real-time feed and opens a Replica ``events`` row for
each qualifying earthquake (create OR update + inside the configured Colombia
box + magnitude >= ``emsc_min_mag``). Each accepted event is deduplicated by
``unid`` (used as ``event_id``), persisted as an open ``EARTHQUAKE`` event and
broadcast to the dashboard as ``EVENT_OPENED``.

The connection loop is deliberate and bounded: the listener is only started by
``main.py``'s lifespan when ``settings.emsc_enabled`` is truthy, reconnects
with a fixed 5s backoff on any failure and never raises out of the loop so the
app cannot crash because of EMSC.
"""

from __future__ import annotations

import asyncio
import json
import logging
from typing import Any

import websockets

from app.core.config import Settings, settings
from app.core.ws import ConnectionManager, manager
from app.models.event import EventType
from app.modules.event_activation.service import activate_event

logger = logging.getLogger(__name__)

# How long to wait before retrying a failed connect/message loop.
_RECONNECT_DELAY_S = 5.0

_ACCEPT_ACTIONS = {"create", "update"}


def in_bbox(payload: dict[str, Any], st: Settings) -> bool:
    """A message ``data.properties`` payload is a qualifier inside the box."""
    try:
        lat = float(payload["lat"])
        lon = float(payload["lon"])
    except (KeyError, TypeError, ValueError):
        return False
    return (
        st.emsc_min_lat <= lat <= st.emsc_max_lat
        and st.emsc_min_lon <= lon <= st.emsc_max_lon
    )


def meets_magnitude(payload: dict[str, Any], st: Settings) -> bool:
    """True when the payload has a numeric magnitude >= the configured floor."""
    try:
        return float(payload["mag"]) >= st.emsc_min_mag
    except (KeyError, TypeError, ValueError):
        return False


def _parse_time(raw: Any) -> Any:
    """Parse an EMSC ISO-8601 timestamp, tolerating a trailing ``Z``."""
    if not isinstance(raw, str) or not raw.strip():
        return None
    from datetime import datetime

    normalized = raw.strip()
    if normalized.endswith("Z"):
        normalized = f"{normalized[:-1]}+00:00"
    try:
        return datetime.fromisoformat(normalized)
    except ValueError:
        return None


def parse_message(message: Any) -> dict[str, Any] | None:
    """Decode a raw WS frame into the EMSC message dict, or None if invalid.

    Accepts ``bytes``/``str`` frames and already-decoded dicts. The EMSC frame
    shape is ``{"action": "...", "data": {"id": ..., "properties": {...}}}`` so
    the decoded message keeps both ``action`` (top level) and ``data``. Returns
    None for malformed JSON or a frame without a usable ``data`` object.
    """
    if isinstance(message, dict):
        payload = message
    elif isinstance(message, (bytes, bytearray)):
        try:
            payload = json.loads(message.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            return None
    elif isinstance(message, str):
        try:
            payload = json.loads(message)
        except json.JSONDecodeError:
            return None
    else:
        return None

    if not isinstance(payload, dict):
        return None
    data = payload.get("data")
    return payload if isinstance(data, dict) else None


async def handle_message(
    message: Any,
    session: Any,
    *,
    ws_manager: ConnectionManager | None = None,
    st: Settings | None = None,
) -> str:
    """Process one EMSC frame: filter, dedup, insert, broadcast.

    Pure-ish and connection-agnostic so it can be unit-driven with a synthetic
    frame and a test session / manager. Returns a short status string:

    ``created`` - new event inserted + EVENT_OPENED broadcast
    ``skipped_dup`` - unid already exists in ``events``
    ``skipped_filter`` - action/bbox/magnitude did not qualify
    ``ignored`` - malformed payload with no usable data
    ``error`` - unexpected failure (logged, never raised)
    """
    st = st or settings
    ws_manager = ws_manager or manager
    msg = parse_message(message)
    if msg is None:
        logger.info("trigger_emsc: ignored non-EMSC message: %r", message)
        return "ignored"

    action = msg.get("action")
    data = msg.get("data")
    payload = data.get("properties")
    if action not in _ACCEPT_ACTIONS or not isinstance(payload, dict):
        logger.info("trigger_emsc: skipped message action=%r", action)
        return "skipped_filter"

    unid = data.get("id") or payload.get("unid")
    if not unid:
        logger.info("trigger_emsc: skipped message with no unid")
        return "skipped_filter"
    if not in_bbox(payload, st) or not meets_magnitude(payload, st):
        logger.info(
            "trigger_emsc: skipped outside box/mag unid=%s mag=%s",
            unid,
            payload.get("mag"),
        )
        return "skipped_filter"

    occurred = _parse_time(payload.get("time"))
    if occurred is None:
        logger.info("trigger_emsc: skipped unparseable time unid=%s", unid)
        return "skipped_filter"

    try:
        import sqlalchemy as sa

        with session.begin():
            result = activate_event(
                session,
                event_id=str(unid),
                event_type=EventType.EARTHQUAKE,
                occurred_at=occurred,
                source="emsc",
                source_key=str(unid),
                actor_id=None,
                audit_metadata={"mag": payload.get("mag"), "region": payload.get("flynn_region")},
            )
        if not result.created:
            logger.info("trigger_emsc: duplicate unid=%s, skipping", unid)
            return "skipped_dup"
    except Exception:  # noqa: BLE001 - log and continue, never crash the app
        logger.exception("trigger_emsc: failed to persist unid=%s", unid)
        session.rollback()
        return "error"

    try:
        await ws_manager.broadcast(
            {
                "type": "EVENT_OPENED",
                "event_id": str(unid),
                "mag": payload.get("mag"),
                "flynn_region": payload.get("flynn_region"),
            }
        )
    except Exception:  # noqa: BLE001 - WS failure must not lose the event
        logger.exception("trigger_emsc: broadcast failed for unid=%s", unid)
        return "error"

    logger.info(
        "trigger_emsc: created event unid=%s mag=%s region=%s",
        unid,
        payload.get("mag"),
        payload.get("flynn_region"),
    )
    return "created"


async def _listen_loop(
    session_factory: Any, st: Settings, ws_manager: ConnectionManager
) -> None:
    """Connect, consume frames forever; reconnect with backoff on failure."""
    async with websockets.connect(st.emsc_url) as websocket:
        logger.info("trigger_emsc: connected to %s", st.emsc_url)
        async for message in websocket:
            try:
                session = session_factory()
                try:
                    await handle_message(
                        message, session, ws_manager=ws_manager, st=st
                    )
                finally:
                    session.close()
            except Exception:  # noqa: BLE001 - guard encode/decode + frame bugs
                logger.exception("trigger_emsc: message handling error")


async def run_emsc_listener(
    session_factory: Any,
    *,
    st: Settings | None = None,
    ws_manager: ConnectionManager | None = None,
) -> None:
    """Run the EMSC listener until cancelled (idempotent, importable helper).

    Wire into the FastAPI lifespan via ``create_task``; the loop retries
    indefinitely every 5s so a transient network failure never stops the task.
    """
    st = st or settings
    ws_manager = ws_manager or manager
    while True:
        try:
            await _listen_loop(session_factory, st, ws_manager)
        except asyncio.CancelledError:
            logger.info("trigger_emsc: listener cancelled")
            raise
        except Exception:  # noqa: BLE001 - never crash the app
            logger.exception(
                "trigger_emsc: connection error, retrying in %ss",
                _RECONNECT_DELAY_S,
            )
        await asyncio.sleep(_RECONNECT_DELAY_S)
