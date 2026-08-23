"""Transactional, idempotent event activation shared by EMSC, SGC, and operators."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime

from sqlalchemy import select, text
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from app.models.event import Event, EventActivation, EventType


@dataclass(frozen=True)
class ActivatedEvent:
    event: Event
    created: bool


def activate_event(
    session: Session,
    *,
    event_id: str,
    event_type: EventType,
    occurred_at: datetime,
    source: str,
    source_key: str,
    actor_id: str | None,
    audit_metadata: dict,
) -> ActivatedEvent:
    """Activate once per source key; serialize revisions through the event row lock."""
    # Serializes retries of the same provider record/idempotency key, including
    # concurrent requests that carry conflicting event payloads.
    session.execute(text("SELECT pg_advisory_xact_lock(hashtext(:key))"), {"key": f"{source}:{source_key}"})
    existing = session.execute(
        select(EventActivation).where(EventActivation.source == source, EventActivation.source_key == source_key)
    ).scalar_one_or_none()
    if existing is not None:
        event = session.get(Event, existing.event_id)
        if event is None:
            raise RuntimeError("Activation audit references a missing event.")
        return ActivatedEvent(event=event, created=False)
    session.execute(
        insert(Event)
        .values(event_id=event_id, event_type=event_type, occurred_at=occurred_at)
        .on_conflict_do_nothing(index_elements=[Event.event_id])
    )
    event = session.execute(select(Event).where(Event.event_id == event_id).with_for_update()).scalar_one()
    next_revision = event.activation_revision + 1
    event.activation_revision = next_revision
    event.activation_source = source
    session.add(
        EventActivation(
            event_id=event.event_id,
            source=source,
            source_key=source_key,
            actor_id=actor_id,
            revision=next_revision,
            audit_metadata=audit_metadata,
        )
    )
    session.flush()
    return ActivatedEvent(event=event, created=True)
