"""SGC standing-order HTTP poller.

Polls the SGC five-day GeoJSON summary feed (``https://archive.sgc.gov.co/...``)
and opens a Replica ``events`` row for each qualifying earthquake (inside the
configured Colombia box + magnitude >= ``sgc_min_mag``). Each accepted event is
deduplicated by the SGC feature ``id`` (used as ``event_id``), persisted as an
open ``EARTHQUAKE`` event and broadcast to the dashboard as ``EVENT_OPENED``.

The poll loop is deliberate and bounded: it is only started by ``main.py``'s
lifespan when ``settings.sgc_enabled`` is truthy, waits ``sgc_poll_interval_s``
between successful polls, backs off with a fixed delay on any failure (one
failed request must not spin) and never raises out of the loop so the app
cannot crash because of SGC. SGC and EMSC are independent siblings: both may be
enabled at once, both write ``EARTHQUAKE`` events, and each is deduplicated by
its own source-specific ``event_id``.
"""

from __future__ import annotations

import asyncio
import json
import logging
from datetime import datetime, timezone
from typing import Any

import httpx

from app.core.config import Settings, settings
from app.core.ws import ConnectionManager, manager
from app.models.event import EventType
from app.modules.event_activation.service import activate_event

logger = logging.getLogger(__name__)

# How long to wait before retrying a failed poll (a single HTTP failure must
# not become a hot loop against the SGC archive).
_BACKOFF_DELAY_S = 5.0

# Request timeout for a single SGC GET (generous for a GeoJSON summary).
_HTTP_TIMEOUT = httpx.Timeout(15.0)

# Accepted timestamp shapes from ``properties.utcTime``. The feed reports
# ``YYYY-MM-DD HH:MM`` (UTC per SGC docs) but a few records carry seconds, so
# tolerate both. Values are naive UTC by convention.
_UTC_TIME_FORMATS = ("%Y-%m-%d %H:%M", "%Y-%m-%d %H:%M:%S")


def _feature_geometry(
    feature: dict[str, Any], st: Settings
) -> tuple[float, float] | None:
    """Extract (lon, lat) from a SGC GeoJSON feature, or None if unusable.

    Docs describe ``coordinates`` as ``[lon, lat, depth]``, but the live feed
    returns ``[lat, lon, depth]``. The two orderings are unambiguous for the
    configured Colombia box because it has opposite-sign ranges (lat 0..14, lon
    -80..-66): the positive coordinate is latitude, the negative one is
    longitude. Detect the orientation instead of assuming one, so both the live
    feed and any docs-shaped payload qualify correctly.
    """
    try:
        coords = feature["geometry"]["coordinates"]
        a, b = float(coords[0]), float(coords[1])
    except (KeyError, TypeError, ValueError, IndexError):
        return None
    if st.sgc_min_lat <= a <= st.sgc_max_lat and st.sgc_min_lon <= b <= st.sgc_max_lon:
        return b, a  # a is lat, b is lon
    if st.sgc_min_lon <= a <= st.sgc_max_lon and st.sgc_min_lat <= b <= st.sgc_max_lat:
        return a, b  # a is lon, b is lat
    return None


def _feature_mag(feature: dict[str, Any]) -> float | None:
    """Extract the numeric ``mag`` from a feature's properties, or None."""
    try:
        return float(feature["properties"]["mag"])
    except (KeyError, TypeError, ValueError):
        return None


def _parse_utc_time(raw: Any) -> datetime | None:
    """Parse SGC ``utcTime`` into a timezone-aware UTC datetime, or None.

    ``utcTime`` is naive UTC per SGC docs; we attach ``timezone.utc`` so the
    stored ``occurred_at`` is timezone-aware like every other Replica event.
    """
    if not isinstance(raw, str) or not raw.strip():
        return None
    value = raw.strip()
    for fmt in _UTC_TIME_FORMATS:
        try:
            return datetime.strptime(value, fmt).replace(tzinfo=timezone.utc)
        except ValueError:
            continue
    return None


async def fetch_features(url: str, *, client: httpx.AsyncClient | None = None) -> list[dict[str, Any]]:
    """GET the SGC feed and return its GeoJSON ``features`` list.

    Raises on transport/HTTP/hard decode errors so the caller's backoff loop
    handles retries; returns an empty list only when the payload legitimately
    has no features.
    """
    if client is not None:
        response = await client.get(url, timeout=_HTTP_TIMEOUT)
    else:
        async with httpx.AsyncClient(timeout=_HTTP_TIMEOUT) as own:
            response = await own.get(url)
    response.raise_for_status()
    payload = json.loads(response.text)
    features = payload.get("features") if isinstance(payload, dict) else None
    return features if isinstance(features, list) else []


def qualify(feature: dict[str, Any], st: Settings) -> tuple[bool, str]:
    """Return ``(qualified, reason)`` for a raw SGC feature.

    A feature qualifies only when it has a usable id, a point inside the
    configured box AND a magnitude >= ``sgc_min_mag``.
    """
    event_id = feature.get("id")
    if not event_id:
        return False, "no id"
    mag = _feature_mag(feature)
    if mag is None:
        return False, f"no mag id={event_id}"
    # _feature_geometry enforces the bbox: it returns None when the point lies
    # outside the configured Colombia box (either coordinate orientation).
    geo = _feature_geometry(feature, st)
    if geo is None:
        return False, f"outside box/no geometry id={event_id}"
    if mag < st.sgc_min_mag:
        return False, f"below mag id={event_id} mag={mag}"
    return True, ""


async def handle_feature(
    feature: dict[str, Any],
    session: Any,
    *,
    ws_manager: ConnectionManager | None = None,
    st: Settings | None = None,
) -> str:
    """Process one SGC feature: filter, dedup, insert, broadcast.

    Pure-ish and HTTP-agnostic so it can be unit-driven with a synthetic
    feature and a test session / manager. Returns a short status string:

    ``created`` - new event inserted + EVENT_OPENED broadcast
    ``skipped_dup`` - the feature id already exists in ``events``
    ``skipped_filter`` - id/bbox/magnitude/time did not qualify
    ``error`` - unexpected failure (logged, never raised)
    """
    st = st or settings
    ws_manager = ws_manager or manager

    event_id = feature.get("id")
    qualified, reason = qualify(feature, st)
    if not qualified:
        logger.info("trigger_sgc: skipped feature %s", reason)
        return "skipped_filter"

    place = feature.get("properties", {}).get("place")
    occurred = _parse_utc_time(feature.get("properties", {}).get("utcTime"))
    if occurred is None:
        logger.info("trigger_sgc: skipped unparseable utcTime id=%s", event_id)
        return "skipped_filter"

    try:
        import sqlalchemy as sa

        with session.begin():
            result = activate_event(
                session,
                event_id=str(event_id),
                event_type=EventType.EARTHQUAKE,
                occurred_at=occurred,
                source="sgc",
                source_key=str(event_id),
                actor_id=None,
                audit_metadata={"mag": _feature_mag(feature), "place": place},
            )
        if not result.created:
            logger.info("trigger_sgc: duplicate id=%s, skipping", event_id)
            return "skipped_dup"
    except Exception:  # noqa: BLE001 - log and continue, never crash the app
        logger.exception("trigger_sgc: failed to persist id=%s", event_id)
        session.rollback()
        return "error"

    try:
        await ws_manager.broadcast(
            {
                "type": "EVENT_OPENED",
                "event_id": str(event_id),
                "mag": _feature_mag(feature),
                "place": place,
            }
        )
    except Exception:  # noqa: BLE001 - WS failure must not lose the event
        logger.exception("trigger_sgc: broadcast failed for id=%s", event_id)
        return "error"

    logger.info(
        "trigger_sgc: created event id=%s mag=%s place=%s",
        event_id,
        _feature_mag(feature),
        place,
    )
    return "created"


async def poll_loop(
    session_factory: Any,
    st: Settings,
    ws_manager: ConnectionManager,
) -> None:
    """Fetch the SGC feed once and process every qualifying feature.

    First poll processes all qualifying features normally (MVP keeps this
    simple — no "only since last poll" catch-up special case). Each feature is
    handled with its own fresh session so an error on one never blocks the rest.
    """
    async with httpx.AsyncClient(timeout=_HTTP_TIMEOUT) as client:
        features = await fetch_features(st.sgc_url, client=client)
        logger.info("trigger_sgc: fetched %s features from %s", len(features), st.sgc_url)
        for feature in features:
            session = session_factory()
            try:
                await handle_feature(feature, session, ws_manager=ws_manager, st=st)
            except Exception:  # noqa: BLE001 - one bad feature never kills a poll
                logger.exception("trigger_sgc: feature handling error")
            finally:
                session.close()


async def run_sgc_poller(
    session_factory: Any,
    *,
    st: Settings | None = None,
    ws_manager: ConnectionManager | None = None,
) -> None:
    """Run the SGC poller until cancelled (idempotent, importable helper).

    Wire into the FastAPI lifespan via ``create_task``; polls every
    ``sgc_poll_interval_s`` and backs off with a fixed delay on any failure so
    a transient network error never stops the task or spins against SGC.
    """
    st = st or settings
    ws_manager = ws_manager or manager
    while True:
        try:
            await poll_loop(session_factory, st, ws_manager)
        except asyncio.CancelledError:
            logger.info("trigger_sgc: poller cancelled")
            raise
        except Exception:  # noqa: BLE001 - never crash the app
            logger.exception(
                "trigger_sgc: poll error, retrying in %ss",
                _BACKOFF_DELAY_S,
            )
            await asyncio.sleep(_BACKOFF_DELAY_S)
            continue
        await asyncio.sleep(st.sgc_poll_interval_s)
