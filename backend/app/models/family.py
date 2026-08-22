"""Family model.

Implements family notifications. Normalization fix vs the old ``families``
sketch in openspec/api.md: the subscription follows the PERSON (``user_id``),
not a single message_id — so the family keeps receiving updates across all
telegrams/cases of their affected person.
"""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Index, String, func
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.types import Uuid

from app.database import Base


class Family(Base):
    __tablename__ = "families"

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid, primary_key=True, default=uuid.uuid4
    )

    user_id: Mapped[str] = mapped_column(
        String, ForeignKey("persons.user_id", ondelete="RESTRICT"), nullable=False
    )

    # Phone number or email of the family member to notify.
    contact: Mapped[str] = mapped_column(String, nullable=False)

    # Token used for WebSocket auth: ws://host/ws?token=... (openspec/api.md,
    # "Autenticación simple").
    ws_token: Mapped[str] = mapped_column(String, nullable=False, unique=True)

    last_notified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    __table_args__ = (Index("ix_families_contact", "contact"),)
