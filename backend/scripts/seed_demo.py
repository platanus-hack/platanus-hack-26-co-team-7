"""Idempotent demo seed for the public dashboard (openspec/changes/dashboard-web).

One command creates an open earthquake Event and H3 ReceivedCell rows around
Bogota (res 8, design D1; varied intensities over two windows to exercise
the GROUP BY / MAX aggregation of design D6). Idempotency (design D3):
reconstruction by fixed event id — every run deletes all data scoped to
DEMO_EVENT_ID (reports FK RESTRICT -> deleted first; received_cells CASCADE)
and reinserts fresh data in
one transaction; no duplicates, other events untouched. CLI limitation (D7):
separate process, cannot broadcast WebSocket updates; start before uvicorn,
clients load state via GET.

Deliberately seeds NO reports: the cells it writes are all
ai_reports/scheduler.py needs to deliver the first SCHEDULED report, so the
feed shows genuine LLM output instead of canned copy. Existing reports for the
event are still deleted, which is what resets the scheduler's cadence.
"""

from __future__ import annotations

import argparse
import uuid
from datetime import date, datetime, timedelta, timezone

import h3

from app.core.constants import H3_CELL_RESOLUTION
from app.core.database import SessionLocal
from app.models.analytics import ReceivedCell, Report  # Report: still deleted for idempotency
from app.models.case import Case
from app.models.event import Event, EventType
from app.models.person import BloodRh, BloodType, Disability, DocType, Person, PersonStatus
from app.models.telegram import Telegram

# Design D3: fixed demo event id; every seed write is scoped to it.
DEMO_EVENT_ID = "DEMO-EARTHQUAKE001"

BOGOTA_LAT = 4.5981
BOGOTA_LNG = -74.0758

# Per cell: (dlat, dlng, intensity_w1, persons_w1, intensity_w2, persons_w2).
# telegram_count stores DISTINCT PERSONS in danger (EMERGENCY/NEED_HELP) per
# cell — the aggregator will COUNT(DISTINCT user_id) in production; here we
# simulate with realistic 0–9 persons per ~500 m cell. Grid ~0.01 deg (~1.1 km).
CELL_SPECS = [
    (0.00, 0.00, 9.0, 8, 7.5, 6),
    (0.01, 0.00, 6.5, 5, 5.0, 4),
    (0.02, 0.00, 3.0, 3, 1.5, 1),
    (-0.01, 0.00, 8.0, 7, 9.5, 9),
    (-0.02, 0.00, 2.5, 2, 0.0, 0),
    (0.00, 0.01, 5.5, 4, 6.0, 5),
    (0.00, -0.01, 7.0, 6, 4.5, 3),
    (0.00, 0.02, 1.0, 1, 0.0, 0),
    (0.00, -0.02, 4.0, 3, 2.5, 2),
    (0.01, 0.01, 6.0, 5, 8.0, 7),
    (-0.01, -0.01, 3.5, 3, 2.0, 2),
    (0.01, -0.01, 5.0, 4, 3.5, 3),
]

# Ordered by dispatch/upload priority: a missing response is handled first,
# followed by a conscious person requesting help, then a confirmed SAFE person.
# (user_id, full_name, status, priority_rank, severity, dlat, dlng)
PERSON_SPECS = [
    ("demo-emergency-001", "Demo Emergency", PersonStatus.EMERGENCY, 3, 5, 0.00, 0.00),
    ("demo-need-help-001", "Demo Need Help", PersonStatus.NEED_HELP, 2, 4, -0.01, 0.00),
    ("demo-safe-001", "Demo Safe", PersonStatus.SAFE, 1, 1, 0.01, 0.01),
]

def build_rows(
    now: datetime,
) -> tuple[Event, list[Person], list[Telegram], list[Case], list[ReceivedCell]]:
    """Build the full demo dataset deterministically from ``now``."""
    occurred_at = now.replace(second=0, microsecond=0)
    window_len = timedelta(minutes=10)
    windows = [occurred_at, occurred_at + window_len]

    event = Event(event_id=DEMO_EVENT_ID, event_type=EventType.EARTHQUAKE,
                  occurred_at=occurred_at,
                  closed_at=None)  # open event: required by both GET endpoints

    people: list[Person] = []
    telegrams: list[Telegram] = []
    cases: list[Case] = []
    for index, (user_id, full_name, status, priority_rank, severity, dlat, dlng) in enumerate(PERSON_SPECS, 1):
        telegram_id = uuid.UUID(f"00000000-0000-4000-8000-{index:012d}")
        lat = BOGOTA_LAT + dlat
        lng = BOGOTA_LNG + dlng
        people.append(Person(
            user_id=user_id,
            full_name=full_name,
            doc_type=DocType.CC,
            doc_number=f"DEMO-{index:03d}",
            birth_date=date(1990 + index, 1, 1),
            blood_type=BloodType.O,
            blood_rh=BloodRh.POSITIVE,
            allergies=[],
            chronic_conditions=[],
            medications=[],
            disability=Disability.NONE,
            is_pregnant=False,
            question_id=f"demo-question-{index}",
            answer_hash=f"{index:x}" * 64,
            device_secret=f"demo-device-secret-{index}",
        ))
        telegrams.append(Telegram(
            id=telegram_id,
            event_id=DEMO_EVENT_ID,
            user_id=user_id,
            status=status,
            event_type=EventType.EARTHQUAKE,
            lat=lat,
            lng=lng,
            origin_ts=occurred_at + timedelta(minutes=index),
            severity=severity,
            hop=index - 1,
            ttl=8 - (index - 1),
            origin_device=f"demo-device-{index}",
            payload={
                "id": str(telegram_id),
                "user_id": user_id,
                "event_id": DEMO_EVENT_ID,
                "status": status.value,
                "timestamp": int((occurred_at + timedelta(minutes=index)).timestamp()),
                "severity": severity,
                "location": {"lat": lat, "lng": lng},
                "hop": index - 1,
                "ttl": 8 - (index - 1),
                "origin": f"demo-device-{index}",
            },
        ))
        cases.append(Case(
            event_id=DEMO_EVENT_ID,
            user_id=user_id,
            current_status=status,
            last_telegram_id=telegram_id,
            priority_rank=priority_rank,
        ))

    cells: list[ReceivedCell] = []
    seen_h3: set[str] = set()
    for dlat, dlng, i_w1, c_w1, i_w2, c_w2 in CELL_SPECS:
        h3_index = h3.latlng_to_cell(BOGOTA_LAT + dlat, BOGOTA_LNG + dlng, H3_CELL_RESOLUTION)
        if h3_index in seen_h3:  # defensive: never violate the unique constraint
            continue
        seen_h3.add(h3_index)
        for window_start, intensity, count in zip(windows, (i_w1, i_w2), (c_w1, c_w2)):
            cells.append(ReceivedCell(
                event_id=DEMO_EVENT_ID, h3_index=h3_index,
                window_start=window_start, window_end=window_start + window_len,
                person_count=count, intensity=intensity,
            ))

    return event, people, telegrams, cases, cells


def seed(session_sessionmaker=SessionLocal) -> dict[str, int]:
    """Rebuild all data scoped to DEMO_EVENT_ID in one transaction."""
    with session_sessionmaker() as session:
        with session.begin():
            # RESTRICT FKs must be deleted before the event. Demo people are
            # scoped by their stable user ids and deleted after their telegrams.
            session.query(Case).where(Case.event_id == DEMO_EVENT_ID).delete()
            session.query(Telegram).where(Telegram.event_id == DEMO_EVENT_ID).delete()
            session.query(Report).where(Report.event_id == DEMO_EVENT_ID).delete()
            session.query(ReceivedCell).where(ReceivedCell.event_id == DEMO_EVENT_ID).delete()
            session.query(Event).where(Event.event_id == DEMO_EVENT_ID).delete()
            session.query(Person).where(
                Person.user_id.in_([spec[0] for spec in PERSON_SPECS])
            ).delete(synchronize_session=False)

            event, people, telegrams, cases, cells = build_rows(datetime.now(timezone.utc))

            session.add(event)
            session.flush()  # ensure event exists before FK-dependent rows (PostgreSQL enforces FKs)
            session.add_all(people)
            session.flush()  # ensure people exist before FK-dependent telegrams and cases
            session.add_all(telegrams)
            session.flush()  # cases.last_telegram_id FKs telegrams.id — insert order is not otherwise guaranteed
            session.add_all(cases)
            session.add_all(cells)

    return {
        "events": 1,
        "people": len(people),
        "telegrams": len(telegrams),
        "cases": len(cases),
        "cells": len(cells),
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description=(
            "Seed the Replica database with demo dashboard data: one open "
            f"earthquake event ({DEMO_EVENT_ID}), H3 res-{H3_CELL_RESOLUTION} "
            "cells around Bogotá with varied intensities over two time "
            "windows, and priority-ordered EMERGENCY/NEED_HELP/SAFE people "
            "and telegrams. No reports: the AI scheduler delivers the first one."
        ),
        epilog=(
            "IDEMPOTENCY (design D3): re-running this command IS the reset. If "
            f"{DEMO_EVENT_ID} already exists, its reports and received_cells are "
            "deleted and everything is reinserted in a single transaction — never "
            "duplicates, never touches other events. No separate --reset flag.\n\n"
            "NOTE (design D7): separate CLI process, cannot broadcast WebSocket "
            "updates. Start BEFORE uvicorn; clients load state via GET on connect."
        ),
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.parse_args(argv)

    counts = seed()
    print(
        f"Demo seed complete: event {DEMO_EVENT_ID}, {counts['people']} people, "
        f"{counts['telegrams']} telegrams, {counts['cases']} cases, "
        f"{counts['cells']} received_cells, 0 reports (the AI scheduler "
        f"delivers the first one)."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
