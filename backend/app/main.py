"""FastAPI application factory for the single-process Replica backend."""

from __future__ import annotations

import asyncio
import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from scalar_fastapi import get_scalar_api_reference

from app.cors import configure_cors
from app.core.config import settings
from app.core.database import SessionLocal
from app.modules.ai_reports import router as ai_reports
from app.modules.dashboard import router as dashboard
from app.modules.gateway_sync.router import router as gateway_sync_router
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

    return app


app = create_app()
