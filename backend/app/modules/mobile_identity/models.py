"""Private mobile identity, contact, credential, and session tables."""

from __future__ import annotations

import enum
import uuid
from datetime import date, datetime

from sqlalchemy import Boolean, Date, DateTime, Enum, ForeignKey, Index, Integer, String, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.types import Uuid

from app.core.database import Base


class DocType(enum.Enum):
    CC = "CC"
    TI = "TI"
    CE = "CE"
    PA = "PA"
    NIT = "NIT"


class BloodType(enum.Enum):
    A = "A"
    B = "B"
    AB = "AB"
    O = "O"


class BloodRh(enum.Enum):
    # API and Android wire contract use enum names, not display glyphs.
    POSITIVE = "POSITIVE"
    NEGATIVE = "NEGATIVE"


class Disability(enum.Enum):
    NONE = "NONE"
    MOBILITY = "MOBILITY"
    VISUAL = "VISUAL"
    HEARING = "HEARING"
    COGNITIVE = "COGNITIVE"


class MobileProfile(Base):
    __tablename__ = "mobile_identity_profiles"

    user_id: Mapped[str] = mapped_column(String, primary_key=True)
    full_name: Mapped[str] = mapped_column(String, nullable=False)
    doc_type: Mapped[DocType] = mapped_column(Enum(DocType, native_enum=False, length=8), nullable=False)
    doc_number: Mapped[str] = mapped_column(String, nullable=False)
    birth_date: Mapped[date] = mapped_column(Date, nullable=False)
    blood_type: Mapped[BloodType] = mapped_column(Enum(BloodType, native_enum=False, length=4), nullable=False)
    blood_rh: Mapped[BloodRh] = mapped_column(Enum(BloodRh, native_enum=False, length=8), nullable=False)
    allergies: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)
    chronic_conditions: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)
    medications: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)
    disability: Mapped[Disability] = mapped_column(Enum(Disability, native_enum=False, length=16), nullable=False)
    is_pregnant: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    weight_kg: Mapped[int | None] = mapped_column(Integer)
    eps: Mapped[str | None] = mapped_column(String)
    question_id: Mapped[str] = mapped_column(String, nullable=False)
    answer_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    __table_args__ = (UniqueConstraint("doc_type", "doc_number", name="uq_mobile_identity_profiles_document"),)


class MobileEmergencyContact(Base):
    __tablename__ = "mobile_identity_emergency_contacts"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    user_id: Mapped[str] = mapped_column(String, ForeignKey("mobile_identity_profiles.user_id", ondelete="CASCADE"), nullable=False)
    name: Mapped[str] = mapped_column(String, nullable=False)
    phone: Mapped[str] = mapped_column(String, nullable=False)
    relationship: Mapped[str] = mapped_column(String, nullable=False)

    __table_args__ = (UniqueConstraint("user_id", "phone", name="uq_mobile_identity_contacts_user_phone"),)


class UserCredential(Base):
    __tablename__ = "mobile_identity_credentials"

    user_id: Mapped[str] = mapped_column(String, ForeignKey("mobile_identity_profiles.user_id", ondelete="CASCADE"), primary_key=True)
    password_hash: Mapped[str] = mapped_column(String, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())


class RefreshSession(Base):
    __tablename__ = "mobile_identity_refresh_sessions"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    user_id: Mapped[str] = mapped_column(String, ForeignKey("mobile_identity_profiles.user_id", ondelete="CASCADE"), nullable=False)
    token_hash: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())

    __table_args__ = (Index("ix_mobile_identity_refresh_sessions_user_id", "user_id"),)


class DeviceIdentity(Base):
    __tablename__ = "mobile_identity_device_identities"

    key_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    public_key: Mapped[str] = mapped_column(String, nullable=False)
    user_id: Mapped[str | None] = mapped_column(String, ForeignKey("mobile_identity_profiles.user_id", ondelete="SET NULL"))
    registered_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    __table_args__ = (
        UniqueConstraint("user_id", "key_id", name="uq_mobile_identity_device_identities_user_key"),
        Index("ix_mobile_identity_device_identities_user_id", "user_id"),
    )
