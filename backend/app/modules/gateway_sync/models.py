"""Private gateway audit records and canonical per-profile state."""

from __future__ import annotations

import enum
import uuid
from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, Enum, Float, ForeignKey, Index, Integer, String, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.types import Uuid

from app.database import Base


class PersonStatus(enum.Enum):
    EMERGENCY = "EMERGENCY"
    NEED_HELP = "NEED_HELP"
    SAFE = "SAFE"


class GatewayEventType(enum.Enum):
    EARTHQUAKE = "EARTHQUAKE"
    FIRE = "FIRE"
    FLOOD = "FLOOD"
    MEDICAL = "MEDICAL"
    OTHER = "OTHER"


class GatewayTelegramRecord(Base):
    __tablename__ = "gateway_sync_telegram_records"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True)
    event_id: Mapped[str] = mapped_column(String, nullable=False)
    user_id: Mapped[str] = mapped_column(String, ForeignKey("mobile_identity_profiles.user_id", ondelete="RESTRICT"), nullable=False)
    gateway_user_id: Mapped[str] = mapped_column(String, ForeignKey("mobile_identity_profiles.user_id", ondelete="RESTRICT"), nullable=False)
    status: Mapped[PersonStatus] = mapped_column(Enum(PersonStatus, native_enum=False, length=16), nullable=False)
    event_type: Mapped[GatewayEventType] = mapped_column(Enum(GatewayEventType, native_enum=False, length=32), nullable=False)
    lat: Mapped[float] = mapped_column(Float, nullable=False)
    lng: Mapped[float] = mapped_column(Float, nullable=False)
    origin_ts: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    severity: Mapped[int] = mapped_column(Integer, nullable=False)
    hop: Mapped[int] = mapped_column(Integer, nullable=False)
    ttl: Mapped[int] = mapped_column(Integer, nullable=False)
    origin_device: Mapped[str] = mapped_column(String, nullable=False)
    hmac_signature: Mapped[str | None] = mapped_column(String)
    question_id: Mapped[str | None] = mapped_column(String)
    answer_hash: Mapped[str | None] = mapped_column(String(64))
    payload: Mapped[dict] = mapped_column(JSONB, nullable=False)
    received_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())

    __table_args__ = (
        CheckConstraint("severity BETWEEN 1 AND 5", name="ck_gateway_sync_records_severity"),
        CheckConstraint("hop >= 0", name="ck_gateway_sync_records_hop_nonneg"),
        CheckConstraint("ttl >= 0", name="ck_gateway_sync_records_ttl_nonneg"),
        Index("ix_gateway_sync_records_event_id", "event_id"),
        Index("ix_gateway_sync_records_user_id", "user_id"),
        Index("ix_gateway_sync_records_gateway_user_id", "gateway_user_id"),
    )


class PersonState(Base):
    __tablename__ = "gateway_sync_person_states"

    user_id: Mapped[str] = mapped_column(String, ForeignKey("mobile_identity_profiles.user_id", ondelete="CASCADE"), primary_key=True)
    current_status: Mapped[PersonStatus] = mapped_column(Enum(PersonStatus, native_enum=False, length=16), nullable=False, default=PersonStatus.EMERGENCY)
    last_telegram_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, ForeignKey("gateway_sync_telegram_records.id", ondelete="SET NULL"))
    emergency_status: Mapped[PersonStatus | None] = mapped_column(Enum(PersonStatus, native_enum=False, length=16))
    emergency_lat: Mapped[float | None] = mapped_column(Float)
    emergency_lng: Mapped[float | None] = mapped_column(Float)
    emergency_timestamp: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    safe_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now())
