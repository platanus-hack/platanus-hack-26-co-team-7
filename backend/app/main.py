"""FastAPI application factory for the single-process Replica backend."""

from __future__ import annotations

import asyncio
import logging
import sys
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

logging.basicConfig(
    level=logging.DEBUG,
    format="%(asctime)s %(levelname)s [%(name)s] %(message)s",
    stream=sys.stderr,
    force=True,
)

from fastapi import FastAPI, WebSocket
from scalar_fastapi import get_scalar_api_reference

from app.cors import configure_cors
from app.core.config import settings
from app.core.database import SessionLocal
from app.modules.ai_reports import router as ai_reports
from app.modules.dashboard import router as dashboard
from app.modules.gateway_sync.router import router as gateway_sync_router
from app.modules.gateway_sync.events import router as gateway_events_router
from app.modules.event_activation.router import router as event_activation_router
from app.modules.event_activation.router import web_router as demo_web_trigger_router
from app.modules.mobile_identity.router import router as mobile_identity_router

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    # Optional EMSC earthquake trigger listener. Disabled by default
    # (settings.emsc_enabled is False), so startup stays network-free.
    emsc_task: asyncio.Task | None = None
    if settings.emsc_enabled:
        from app.modules.trigger_emsc import listener as emsc_listener

        emsc_task = asyncio.create_task(
            emsc_listener.run_emsc_listener(SessionLocal)
        )
        logger.info("EMSC earthquake trigger listener started (%s)", settings.emsc_url)

    # Optional SGC earthquake trigger poller. Disabled by default
    # (settings.sgc_enabled is False), so startup stays network-free.
    sgc_task: asyncio.Task | None = None
    if settings.sgc_enabled:
        from app.modules.trigger_sgc import poller as sgc_poller

        sgc_task = asyncio.create_task(
            sgc_poller.run_sgc_poller(SessionLocal)
        )
        logger.info("SGC earthquake trigger poller started (%s)", settings.sgc_url)

    # Optional automatic AI report delivery scheduler. Disabled by default
    # (settings.ai_reports_enabled is False), so startup stays side-effect-free.
    ai_scheduler_task: asyncio.Task | None = None
    if settings.ai_reports_enabled:
        from app.modules.ai_reports import scheduler as ai_scheduler

        ai_scheduler_task = asyncio.create_task(
            ai_scheduler.run_report_scheduler(SessionLocal)
        )
        logger.info("AI report scheduler started (every %ss)", settings.ai_report_scheduler_interval_s)

    # Optional H3 spatial aggregator (gateway_sync.aggregator). Disabled by
    # default (settings.aggregator_enabled is False), so startup stays
    # side-effect-free.
    aggregator_task: asyncio.Task | None = None
    if settings.aggregator_enabled:
        from app.modules.gateway_sync import aggregator as agg

        aggregator_task = asyncio.create_task(
            agg.run_aggregator(SessionLocal)
        )
        logger.info("Gateway H3 aggregator started (every %ss)", settings.aggregator_interval_s)
    yield

    if emsc_task is not None:
        emsc_task.cancel()
        try:
            await emsc_task
        except asyncio.CancelledError:
            pass
        logger.info("EMSC earthquake trigger listener stopped")

    if sgc_task is not None:
        sgc_task.cancel()
        try:
            await sgc_task
        except asyncio.CancelledError:
            pass
        logger.info("SGC earthquake trigger poller stopped")

    if ai_scheduler_task is not None:
        ai_scheduler_task.cancel()
        try:
            await ai_scheduler_task
        except asyncio.CancelledError:
            pass
        logger.info("AI report scheduler stopped")

    if aggregator_task is not None:
        aggregator_task.cancel()
        try:
            await aggregator_task
        except asyncio.CancelledError:
            pass
        logger.info("Gateway H3 aggregator stopped")


def create_app() -> FastAPI:
    app = FastAPI(
        title="Replica Backend",
        description="Emergency communication network API",
        version="0.1.0",
        lifespan=lifespan,
        docs_url=None,
        redoc_url=None,
    )

    @app.get("/docs", include_in_schema=False)
    async def scalar_docs():
        return get_scalar_api_reference(
            openapi_url=app.openapi_url,
            title="Replica API Reference",
        )

    configure_cors(app)

    app.include_router(dashboard.router)
    app.include_router(ai_reports.router)
    app.include_router(mobile_identity_router)
    app.include_router(gateway_sync_router)
    app.include_router(gateway_events_router)
    app.include_router(event_activation_router)
    # Anonymous; the route itself 404s unless DEMO_WEB_TRIGGER_ENABLED is set.
    app.include_router(demo_web_trigger_router)

    # Realtime broadcast channel: contract is an anonymous WS at the root
    # path ("WS /ws"). It must NOT be mounted under /api/v1 (the dashboard
    # router's prefix), otherwise clients that follow the contract get a 403
    # because the path does not resolve. See dashboard/router.py.
    @app.websocket("/ws")
    async def ws_broadcast(websocket: WebSocket) -> None:
        from fastapi import WebSocketDisconnect as _Disconnect
        from app.core.ws import manager as ws_manager

        if not ws_manager.origin_allowed(websocket.headers.get("origin")):
            await websocket.close(code=1008)  # policy violation: untrusted origin
            return

        await ws_manager.connect(websocket)
        try:
            while True:
                # Broadcast-only channel: client frames are read and ignored,
                # the loop doubles as liveness detection for clean disconnects.
                await websocket.receive_text()
        except _Disconnect:
            pass
        finally:
            ws_manager.disconnect(websocket)

    return app


app = create_app()
