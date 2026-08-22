"""Idempotent demo seed for the public dashboard (openspec/changes/dashboard-web).

Single command that creates one open earthquake Event, H3 ``ReceivedCell``
rows around Bogota (res 8 per design D1, varied intensities over two time
windows to exercise the GROUP BY / MAX aggregation of design D6), and AI
``Report`` rows whose ``content`` follows schema v1 of design D2.

Idempotency (design D3): reconstruction by fixed event id — every run deletes
all data scoped to ``DEMO_EVENT_ID`` and reinserts fresh data in one
transaction, so re-running never duplicates and never touches other events.
``reports`` FK is RESTRICT (delete first); ``received_cells`` is CASCADE but
deleted explicitly too because SQLite does not enforce FKs by default.

CLI limitation (design D7): separate process — cannot call the WebSocket
ConnectionManager. Run this BEFORE uvicorn; clients load state via GET.
"""

from __future__ import annotations

import argparse
import uuid
from datetime import datetime, timedelta, timezone

import h3
from sqlalchemy import func

from app.constants import H3_CELL_RESOLUTION
from app.database import Base, SessionLocal, engine
from app.models.analytics import ReceivedCell, Report, ReportSource
from app.models.event import Event, EventType

# Design D3: fixed demo event id. All seed writes are scoped to it.
DEMO_EVENT_ID = "DEMO-EARTHQUAKE001"

# Bogota city center (Plaza de Bolivar); seed points are offsets from here.
BOGOTA_LAT = 4.5981
BOGOTA_LNG = -74.0758

# Grid spacing ~0.01 deg (~1.1 km) keeps every point in a distinct res-8
# cell. Per cell: (dlat, dlng, intensity_w1, count_w1, intensity_w2, count_w2).
CELL_SPECS: list[tuple[float, float, float, int, float, int]] = [
    (0.00, 0.00, 9.0, 42, 7.5, 30),
    (0.01, 0.00, 6.5, 21, 5.0, 12),
    (0.02, 0.00, 3.0, 8, 1.5, 3),
    (-0.01, 0.00, 8.0, 35, 9.5, 48),
    (-0.02, 0.00, 2.5, 6, 0.0, 0),
    (0.00, 0.01, 5.5, 17, 6.0, 20),
    (0.00, -0.01, 7.0, 26, 4.5, 10),
    (0.00, 0.02, 1.0, 2, 0.0, 0),
    (0.00, -0.02, 4.0, 11, 2.5, 5),
    (0.01, 0.01, 6.0, 19, 8.0, 33),
    (-0.01, -0.01, 3.5, 9, 2.0, 4),
    (0.01, -0.01, 5.0, 14, 3.5, 7),
]

REPORT_TEMPLATES: list[tuple[ReportSource, int, str, str, list[str], dict]] = [
    (
        ReportSource.SCHEDULED,
        15,  # minutes after occurred_at
        "Sismo M5.6 en Bogotá — evaluación inicial",
        "Se registran múltiples reportes desde el centro de Bogotá. "
        "Las celdas con mayor intensidad se concentran alrededor del centro "
        "y la zona sur-occidental. No hay evidencia de daños estructurales "
        "mayores en los datos disponibles.",
        [
            "Priorizar la verificación de personas atrapadas en las celdas "
            "de intensidad alta.",
            "Mantener abiertos los corredores de evacuación hacia el norte.",
        ],
        {"cells_active": 12, "people_helped": 18},
    ),
    (
        ReportSource.SCHEDULED,
        45,
        "Evolución a los 45 minutos: focos activos y estabilización",
        "La intensidad decrece en la mayoría de celdas respecto a la primera "
        "ventana. Dos focos permanecen activos con conteo creciente de "
        "telegrams, lo que sugiere ayuda requerida continua en esos puntos.",
        [
            "Redirir brigadas a los dos focos con tendencia creciente.",
            "Confirmar estado SAFE de las personas marcadas NEED_HELP.",
        ],
        {"cells_active": 12, "people_helped": 34},
    ),
    (
        ReportSource.MANUAL,
        90,
        "Reporte manual del coordinador — cierre parcial de zonas",
        "El coordinador marca la zona norte como estabilizada. Persisten "
        "dos focos de atención al sur-occidente; se recomienda mantener el "
        "evento abierto hasta su verificación.",
        [
            "Mantener el evento abierto hasta confirmar SAFE en los focos "
            "activos.",
        ],
        {"cells_active": 10, "people_helped": 51},
    ),
]


def build_rows(now: datetime) -> tuple[Event, list[ReceivedCell], list[Report]]:
    """Build the full demo dataset deterministically from ``now``."""
    occurred_at = now.replace(second=0, microsecond=0)
    window_len = timedelta(minutes=10)
    windows = [occurred_at, occurred_at + window_len]

    event = Event(
        event_id=DEMO_EVENT_ID,
        event_type=EventType.EARTHQUAKE,
        occurred_at=occurred_at,
        closed_at=None,  # open event: required by both GET endpoints
    )

    cells: list[ReceivedCell] = []
    seen_h3: set[str] = set()
    for dlat, dlng, i_w1, c_w1, i_w2, c_w2 in CELL_SPECS:
        h3_index = h3.latlng_to_cell(
            BOGOTA_LAT + dlat, BOGOTA_LNG + dlng, H3_CELL_RESOLUTION
        )
        if h3_index in seen_h3:  # defensive: never violate the unique constraint
            continue
        seen_h3.add(h3_index)
        for idx, (window_start, intensity, count) in enumerate(
            zip(windows, (i_w1, i_w2), (c_w1, c_w2))
        ):
            cells.append(
                ReceivedCell(
                    event_id=DEMO_EVENT_ID,
                    h3_index=h3_index,
                    window_start=window_start,
                    window_end=window_start + window_len,
                    telegram_count=count,
                    intensity=intensity,
                )
            )

    reports = [
        Report(
            id=uuid.uuid4(),
            event_id=DEMO_EVENT_ID,
            source=source,
            generated_at=occurred_at + timedelta(minutes=offset_min),
            content={
                "version": 1,
                "title": title,
                "summary": summary,
                "recommendations": recommendations,
                "figures": figures,
            },
        )
        for source, offset_min, title, summary, recommendations, figures
        in REPORT_TEMPLATES
    ]
    return event, cells, reports


def seed(session_sessionmaker=SessionLocal, target_engine=engine) -> dict[str, int]:
    """Rebuild all demo data inside one transaction; return inserted counts."""
    Base.metadata.create_all(target_engine)

    with session_sessionmaker() as session:
        with session.begin():
            # reports FK is RESTRICT -> must be deleted BEFORE the event;
            # received_cells FK is CASCADE but we delete explicitly too
            # (SQLite does not enforce FKs by default).
            session.query(Report).where(Report.event_id == DEMO_EVENT_ID).delete()
            session.query(ReceivedCell).where(
                ReceivedCell.event_id == DEMO_EVENT_ID
            ).delete()
            session.query(Event).where(Event.event_id == DEMO_EVENT_ID).delete()

            event, cells, reports = build_rows(datetime.now(timezone.utc))

            # SQLite smoke-test portability: BIGINT autoincrement PKs do not
            # work on SQLite, so ids are assigned explicitly (max + n).
            next_id = (session.query(func.max(ReceivedCell.id)).scalar() or 0) + 1
            for cell in cells:
                cell.id = next_id
                next_id += 1

            session.add(event)
            session.add_all(cells)
            session.add_all(reports)

    return {
        "events": 1,
        "cells": len(cells),
        "reports": len(reports),
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description=(
            "Seed the ZIRO database with demo dashboard data: one open "
            f"earthquake event ({DEMO_EVENT_ID}), H3 res-{H3_CELL_RESOLUTION} "
            "cells around Bogotá with varied intensities over two time "
            "windows, and AI-style reports (schema v1)."
        ),
        epilog=(
            "IDEMPOTENCY (design D3): re-running this command IS the reset. "
            f"If {DEMO_EVENT_ID} already exists, its reports and "
            "received_cells are deleted and everything is reinserted in a "
            "single transaction — never duplicates, never touches other "
            "events. There is deliberately no separate --reset flag.\n\n"
            "NOTE (design D7): as a separate CLI process this script cannot "
            "broadcast WebSocket updates. Start it BEFORE uvicorn; dashboard "
            "clients load state via GET when they connect."
        ),
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.parse_args(argv)

    counts = seed()
    print(
        f"Demo seed complete: event {DEMO_EVENT_ID}, "
        f"{counts['cells']} received_cells, {counts['reports']} reports."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
