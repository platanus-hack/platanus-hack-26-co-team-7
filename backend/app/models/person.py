"""Person profile model + emergency contacts.

Implements the onboarding profile (loaded once, before any disaster, over
Internet) per the team's PART 1 data contract. Two tables:

- ``persons``: one row per ``user_id``; holds EVERYTHING the backend needs
  for hospital admission, family notification and SAFE verification,
  including the HMAC ``device_secret`` registered at onboarding.
- ``emergency_contacts``: normalized child table for the repeating
  ``{name, phone, relationship}`` group.

Privacy rules:
- ``device_secret`` never leaves the server side and must never be exposed
  by any endpoint; it only verifies incoming telegrams' HMAC signatures.
- Raw coordinates/sid stay server-side (openspec/architecture.md).
"""

from __future__ import annotations

import enum
import uuid
from datetime import date, datetime

from sqlalchemy import (
    Boolean,
    Date,
    DateTime,
    Enum,
    ForeignKey,
    Integer,
    String,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.types import Uuid

from app.core.database import Base


class DocType(enum.Enum):
    """Colombian identity document types."""

    CC = "CC"      # Cédula de ciudadanía
    TI = "TI"      # Tarjeta de identidad
    CE = "CE"      # Cédula de extranjería
    PA = "PA"      # Pasaporte
    NIT = "NIT"    # Número de identificación tributaria


class BloodType(enum.Enum):
    """ABO blood group."""

    A = "A"
    B = "B"
    AB = "AB"
    O = "O"


class BloodRh(enum.Enum):
    """Rhesus factor, stored separately: O- is the universal donor, O+ is not."""

    POSITIVE = "+"
    NEGATIVE = "-"


class PersonStatus(enum.Enum):
    """State of the AFFECTED PERSON (orthogonal to node states, which never
    reach this database). Transitions: EMERGENCY->SAFE, EMERGENCY->NEED_HELP,
    NEED_HELP->SAFE only (protocol.md section 4)."""

    EMERGENCY = "EMERGENCY"
    NEED_HELP = "NEED_HELP"
    SAFE = "SAFE"


class Disability(enum.Enum):
    """Disability class; defines HOW the person is rescued."""

    NONE = "NONE"
    MOBILITY = "MOBILITY"
    VISUAL = "VISUAL"
    HEARING = "HEARING"
    COGNITIVE = "COGNITIVE"


def _json_array(**kwargs):  # noqa: ANN001, ANN003
    """JSONB column (PostgreSQL-only)."""
    return JSONB()


class Person(Base):
    __tablename__ = "persons"

    user_id: Mapped[str] = mapped_column(String, primary_key=True)

    # --- Identity (hospital admission / authorities) ---
    full_name: Mapped[str] = mapped_column(String, nullable=False)
    doc_type: Mapped[DocType] = mapped_column(
        Enum(DocType, native_enum=False, length=8), nullable=False
    )
    doc_number: Mapped[str] = mapped_column(String, nullable=False)
    # Birth date instead of age: derived at read time, more stable.
    birth_date: Mapped[date] = mapped_column(Date, nullable=False)

    # --- Medical (triage-critical; separated ABO/Rh) ---
    blood_type: Mapped[BloodType] = mapped_column(
        Enum(BloodType, native_enum=False, length=4), nullable=False
    )
    # NOTE: SQLAlchemy persists the enum MEMBER NAME ("POSITIVE"/"NEGATIVE",
    # not "+"/"-"), hence length=8.
    blood_rh: Mapped[BloodRh] = mapped_column(
        Enum(BloodRh, native_enum=False, length=8), nullable=False
    )
    allergies: Mapped[list] = mapped_column(_json_array(), nullable=False, default=list)
    chronic_conditions: Mapped[list] = mapped_column(
        _json_array(), nullable=False, default=list
    )
    medications: Mapped[list | None] = mapped_column(_json_array())
    disability: Mapped[Disability] = mapped_column(
        Enum(Disability, native_enum=False, length=16), nullable=False
    )
    is_pregnant: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    weight_kg: Mapped[int | None] = mapped_column(Integer)
    eps: Mapped[str | None] = mapped_column(String)

    # --- SAFE verification (plaintext answer NEVER stored anywhere) ---
    question_id: Mapped[str] = mapped_column(String, nullable=False)
    answer_hash: Mapped[str] = mapped_column(String(64), nullable=False)

    # --- HMAC key, shared ONLY during onboarding over TLS. Server-side copy
    # used to verify telegram signatures; never returned by endpoints and
    # never carried by the mesh (protocol.md Rule 5). ---
    device_secret: Mapped[str] = mapped_column(String, nullable=False)

    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

class EmergencyContact(Base):
    """Repeating {name, phone, relationship} group from the onboarding profile.

    Normalized as its own table (not JSONB): the backend resolves family
    notification through this table by ``user_id`` — phone numbers of family
    members never travel inside telegrams (PART 1 decision, see DECISIONS.md).
    """

    __tablename__ = "emergency_contacts"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)

    user_id: Mapped[str] = mapped_column(
        String, ForeignKey("persons.user_id", ondelete="CASCADE"), nullable=False
    )

    name: Mapped[str] = mapped_column(String, nullable=False)
    phone: Mapped[str] = mapped_column(String, nullable=False)
    relationship: Mapped[str] = mapped_column(String, nullable=False)

    __table_args__ = (
        UniqueConstraint("user_id", "phone", name="uq_emergency_contacts_person_phone"),
    )
