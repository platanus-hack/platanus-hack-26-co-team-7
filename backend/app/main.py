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
from scalar_fastapi import get_scalar_api_reference

from app.cors import configure_cors
from app.routers import heatmap, reports
from app.routers import ws as ws_router
from app.modules.gateway_sync.router import router as gateway_sync_router
from app.modules.mobile_identity.router import router as mobile_identity_router


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    yield


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

    app.include_router(heatmap.router)
    app.include_router(reports.router)
    app.include_router(ws_router.router)
    app.include_router(mobile_identity_router)
    app.include_router(gateway_sync_router)

    return app


app = create_app()
