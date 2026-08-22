"""Event model.

Implements the ``events`` table from openspec/architecture.md (Componente 3)
and openspec/api.md ("Modelo de datos"). An event is one disaster instance
(e.g. ``EARTHQUAKE001``) that groups all related telegrams via ``event_id``.
"""

from __future__ import annotations

import enum
from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, Enum, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class EventType(enum.Enum):
    """Disaster type carried by telegrams (openspec/protocol.md section 1)."""

    EARTHQUAKE = "EARTHQUAKE"
    FIRE = "FIRE"
    FLOOD = "FLOOD"
    MEDICAL = "MEDICAL"
    OTHER = "OTHER"


class EventCloseReason(enum.Enum):
    """Why an event was closed (openspec/api.md, Emergency Orchestrator #6)."""

    ALL_SAFE = "ALL_SAFE"
    TIMEOUT = "TIMEOUT"
    MANUAL = "MANUAL"


class Event(Base):
    __tablename__ = "events"

    event_id: Mapped[str] = mapped_column(String, primary_key=True)

    event_type: Mapped[EventType] = mapped_column(
        Enum(EventType, native_enum=False, length=32), nullable=False
    )

    occurred_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    closed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    closed_reason: Mapped[EventCloseReason | None] = mapped_column(
        Enum(EventCloseReason, native_enum=False, length=32)
    )

    __table_args__ = (
        # closed_reason is set if and only if the event is closed.
        CheckConstraint(
            "(closed_at IS NULL) = (closed_reason IS NULL)",
            name="ck_events_closed_pairing",
        ),
    )
