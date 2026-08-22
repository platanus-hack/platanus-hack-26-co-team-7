"""FastAPI application factory for the Replica backend.

Single-process app (openspec/architecture.md, Componente 2): ingestion,
trigger engine, H3 aggregation, AI reports and this readonly public API are
internal modules sharing the DB and process — no inter-module HTTP. This
module exposes only the public read-only dashboard surface (heatmap, reports,
WS broadcast) per openspec/changes/dashboard-web (spec public-api-readonly).
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.database import Base, engine
from app.routers import heatmap, reports
from app.routers import ws as ws_router


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    # Import registers every ORM model on Base.metadata (idempotent create).
    import app.models  # noqa: F401

    Base.metadata.create_all(bind=engine)
    yield


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

    app.include_router(heatmap.router)
    app.include_router(reports.router)
    app.include_router(ws_router.router)

    return app


app = create_app()
