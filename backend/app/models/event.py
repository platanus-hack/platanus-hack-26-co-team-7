"""Event model.

Implements the ``events`` table from openspec/architecture.md (Componente 3)
and openspec/api.md ("Modelo de datos"). An event is one disaster instance
(e.g. ``EARTHQUAKE001``) that groups all related telegrams via ``event_id``.
"""

from __future__ import annotations

import enum
from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, Enum, ForeignKey, Integer, String, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


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

    activation_revision: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    activation_source: Mapped[str | None] = mapped_column(String(32))


    __table_args__ = (
        # closed_reason is set if and only if the event is closed.
        CheckConstraint(
            "(closed_at IS NULL) = (closed_reason IS NULL)",
            name="ck_events_closed_pairing",
        ),
    )


class EventActivation(Base):
    """Append-only source and audit record for an event activation."""

    __tablename__ = "event_activations"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    event_id: Mapped[str] = mapped_column(String, ForeignKey("events.event_id", ondelete="CASCADE"), nullable=False)
    source: Mapped[str] = mapped_column(String(32), nullable=False)
    source_key: Mapped[str] = mapped_column(String(256), nullable=False)
    actor_id: Mapped[str | None] = mapped_column(String)
    revision: Mapped[int] = mapped_column(Integer, nullable=False)
    audit_metadata: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    activated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())

    __table_args__ = (UniqueConstraint("source", "source_key", name="uq_event_activations_source_key"),)
