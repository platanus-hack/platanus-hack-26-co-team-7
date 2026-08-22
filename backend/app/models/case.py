"""Case model.

Implements the Emergency Orchestrator's per-(event, person) current state
(openspec/api.md, "Emergency Orchestrator"): groups telegrams by ``user_id``
within one ``event_id`` and holds the consolidated person status plus the
notification priority (protocol.md section 4: NEED_HELP > EMERGENCY > SAFE).
"""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import (
    DateTime,
    Enum,
    ForeignKey,
    Integer,
    String,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.types import Uuid

from app.database import Base
from app.models.person import PersonStatus


class Case(Base):
    __tablename__ = "cases"

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid, primary_key=True, default=uuid.uuid4
    )

    event_id: Mapped[str] = mapped_column(
        String, ForeignKey("events.event_id", ondelete="RESTRICT"), nullable=False
    )
    user_id: Mapped[str] = mapped_column(
        String, ForeignKey("persons.user_id", ondelete="RESTRICT"), nullable=False
    )

    # Current consolidated status of this person within this event.
    current_status: Mapped[PersonStatus] = mapped_column(
        Enum(PersonStatus, native_enum=False, length=16),
        nullable=False,
        default=PersonStatus.EMERGENCY,
    )

    # Telegram that produced the current state (nullable until first telegram
    # is linked; RESTRICT so audit history is never silently deleted).
    last_telegram_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("telegrams.id", ondelete="SET NULL")
    )

    # Derived ordering key for the orchestrator's priority queue:
    #   NEED_HELP = 2  >  EMERGENCY = 1  >  SAFE = 0
    # Stored as a plain int on purpose; the mapping above is authoritative
    # (protocol.md section 4 priority table).
    priority_rank: Mapped[int] = mapped_column(Integer, nullable=False, default=1)

    opened_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    closed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    __table_args__ = (
        UniqueConstraint("event_id", "user_id", name="uq_cases_event_person"),
    )
