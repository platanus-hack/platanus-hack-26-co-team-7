"""FastAPI application factory for the Replica backend.

Single-process app (openspec/architecture.md, Componente 2): ingestion,
trigger engine, H3 aggregation, AI reports and this readonly public API are
internal modules sharing the DB and process — no inter-module HTTP. This
module exposes only the public read-only dashboard surface (heatmap, reports,
WS broadcast) per openspec/changes/dashboard-web (spec public-api-readonly).
"""

from __future__ import annotations

import asyncio
import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.core.config import settings
from app.core.database import Base, SessionLocal, engine
from app.modules.ai_reports import router as ai_reports
from app.modules.dashboard import router as dashboard

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    # Import registers every ORM model on Base.metadata (idempotent create).
    import app.models  # noqa: F401

    Base.metadata.create_all(bind=engine)

    # Optional EMSC earthquake trigger listener. Disabled by default
    # (settings.emsc_enabled is False), so startup stays network-free.
    emsc_task: asyncio.Task | None = None
    if settings.emsc_enabled:
        from app.modules.trigger_emsc import listener as emsc_listener

        emsc_task = asyncio.create_task(
            emsc_listener.run_emsc_listener(SessionLocal)
        )
        logger.info("EMSC earthquake trigger listener started (%s)", settings.emsc_url)

    yield

    if emsc_task is not None:
        emsc_task.cancel()
        try:
            await emsc_task
        except asyncio.CancelledError:
            pass
        logger.info("EMSC earthquake trigger listener stopped")


def create_app() -> FastAPI:
    app = FastAPI(
        title="Replica Backend",
        description="Emergency communication network - public read-only API",
        version="0.1.0",
        lifespan=lifespan,
    )

    # Explicit origin allowlist; wildcard with credentials is forbidden by
    # the public-api-readonly spec.
    app.add_middleware(
        CORSMiddleware,
        allow_origins=list(settings.cors_origins),
        allow_credentials=False,
        allow_methods=["GET", "OPTIONS"],
        allow_headers=["*"],
    )

    app.include_router(dashboard.router)
    app.include_router(ai_reports.router)

    return app


app = create_app()
