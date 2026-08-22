"""ZIRO backend models package.

Re-exports every ORM model and enum so that ``import app.models`` registers
all tables on ``Base.metadata`` (required for ``create_all`` / Alembic).
"""

from app.models.event import Event, EventCloseReason, EventType
from app.models.person import (
    BloodRh,
    BloodType,
    Disability,
    DocType,
    EmergencyContact,
    Person,
    PersonStatus,
)
from app.models.telegram import Telegram
from app.models.hop import TelegramHop
from app.models.case import Case
from app.models.family import Family
from app.models.evidence import EvidenceChunk, EvidenceKind
from app.models.analytics import ReceivedCell, Report, ReportSource

__all__ = [
    "Event",
    "EventCloseReason",
    "EventType",
    "BloodRh",
    "BloodType",
    "Disability",
    "DocType",
    "EmergencyContact",
    "Person",
    "PersonStatus",
    "Telegram",
    "TelegramHop",
    "Case",
    "Family",
    "EvidenceChunk",
    "EvidenceKind",
    "ReceivedCell",
    "Report",
    "ReportSource",
]
