"""Telegram model.

Implements the ``telegrams`` table (openspec/architecture.md, Componente 3)
from the telegram schema v1 in openspec/protocol.md section 1.

The primary key ``id`` is the protocol's universal dedup UUID v4 (Rule 1 of
protocol.md). ``id`` is NOT ``user_id`` — telegrams are grouped per person via
``user_id`` and per disaster via ``event_id``.

``payload`` keeps a complete, immutable JSONB copy of the raw telegram exactly
as received: normalization into columns drops origin-time snapshot fields
(name/blood/age/etc. carried by each message), and the audit copy preserves
them. Coordinates and identifiers stay server-side only (privacy invariant,
architecture.md).
"""

from __future__ import annotations

import enum
import uuid
from datetime import datetime

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    Enum,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.types import Uuid

from app.core.database import Base
from app.models.event import EventType
from app.models.person import PersonStatus


class Telegram(Base):
    __tablename__ = "telegrams"

    # Protocol dedup UUID v4 ("id" field).
    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True)

    event_id: Mapped[str] = mapped_column(
        String,
        ForeignKey("events.event_id", ondelete="RESTRICT"),
        nullable=False,
    )
    user_id: Mapped[str] = mapped_column(
        String,
        ForeignKey("persons.user_id", ondelete="RESTRICT"),
        nullable=False,
    )
    status: Mapped[PersonStatus] = mapped_column(
        Enum(PersonStatus, native_enum=False, length=16), nullable=False
    )
    event_type: Mapped[EventType] = mapped_column(
        Enum(EventType, native_enum=False, length=32), nullable=False
    )

    # Both null or both present (protocol "location" object).
    lat: Mapped[float | None] = mapped_column(Float)
    lng: Mapped[float | None] = mapped_column(Float)

    # Protocol "timestamp": epoch seconds at origin.
    origin_ts: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)

    severity: Mapped[int] = mapped_column(Integer, nullable=False)  # 1..5
    hop: Mapped[int] = mapped_column(Integer, nullable=False)  # >= 0
    ttl: Mapped[int] = mapped_column(Integer, nullable=False)  # > 0

    # Protocol "origin": short device hash.
    origin_device: Mapped[str] = mapped_column(String, nullable=False)

    # Optional HMAC-SHA256 signature (protocol Rule 5).
    hmac_signature: Mapped[str | None] = mapped_column(String)

    # SAFE-verification snapshot carried by THIS telegram. Current person-level
    # values live on persons; this is the historical copy from the message.
    question_id: Mapped[str | None] = mapped_column(String)
    answer_hash: Mapped[str | None] = mapped_column(String(64))

    # Immutable audit copy of the complete raw telegram as received.
    # JSONB on PostgreSQL (PostgreSQL-only runtime).
    payload: Mapped[dict] = mapped_column(JSONB, nullable=False)

    received_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    __table_args__ = (
        CheckConstraint(
            "(lat IS NULL) = (lng IS NULL)", name="ck_telegrams_location_pairing"
        ),
        CheckConstraint("severity BETWEEN 1 AND 5", name="ck_telegrams_severity"),
        CheckConstraint("hop >= 0", name="ck_telegrams_hop_nonneg"),
        CheckConstraint("ttl > 0", name="ck_telegrams_ttl_positive"),
        Index("ix_telegrams_event_id", "event_id"),
        Index("ix_telegrams_user_id", "user_id"),
        Index("ix_telegrams_received_at", "received_at"),
    )
