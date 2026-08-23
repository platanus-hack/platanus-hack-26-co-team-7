"""In-process WebSocket connection manager (design D7).

Single broadcast channel for the public dashboard. Notifications are raised
by direct in-process calls (``manager.broadcast(...)``) — never via internal
HTTP — honoring the no-inter-module-HTTP rule. Documented limitation: a
``seed_demo.py`` CLI run in another process cannot reach this manager; demo
clients reconcile state via GET on connect.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any
from uuid import UUID

from fastapi import WebSocket

from app.core.config import settings

logger = logging.getLogger(__name__)


class ConnectionManager:
    """Tracks active dashboard sockets and broadcasts typed notifications."""

    def __init__(self, allowed_origins: tuple[str, ...] = ()) -> None:
        self._connections: set[WebSocket] = set()
        self._allowed_origins = set(allowed_origins)
        self._lock = asyncio.Lock()

    def origin_allowed(self, origin: str | None) -> bool:
        """Browser origins must be whitelisted; non-browser clients (no
        Origin header) are accepted."""
        if origin is None:
            return True
        return origin in self._allowed_origins

    async def connect(self, websocket: WebSocket) -> None:
        await websocket.accept()
        self._connections.add(websocket)

    def disconnect(self, websocket: WebSocket) -> None:
        self._connections.discard(websocket)

    @property
    def connection_count(self) -> int:
        return len(self._connections)

    async def broadcast(self, message: dict[str, Any]) -> None:
        """Send a typed message to every connected client; drop dead sockets.

        Only notification envelopes travel here (CELLS_UPDATED /
        REPORT_CREATED) — never full state, which clients reconcile by GET.
        """
        async with self._lock:
            targets = list(self._connections)
        for websocket in targets:
            try:
                await websocket.send_json(message)
            except Exception:  # noqa: BLE001 - any send failure drops the socket
                self.disconnect(websocket)
                logger.debug("Dropped dead WebSocket during broadcast")

    # Typed message builders (public-api-readonly WS contract).

    async def broadcast_cells_updated(self, event_id: str) -> None:
        await self.broadcast({"type": "CELLS_UPDATED", "event_id": event_id})

    async def broadcast_report_created(
        self, event_id: str, report_id: UUID
    ) -> None:
        await self.broadcast(
            {
                "type": "REPORT_CREATED",
                "event_id": event_id,
                "report_id": str(report_id),
            }
        )


manager = ConnectionManager(allowed_origins=settings.cors_origins)
