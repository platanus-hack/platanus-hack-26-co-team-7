"""Analytics models: AI reports and H3 aggregation cache.

- ``reports``: LLM-generated narrative reports (openspec/architecture.md,
  "Reportes IA"). The LLM only narrates deterministic SQL aggregates — it
  never computes figures — and its JSON output is schema-validated upstream.
- ``received_cells``: cache of the spatial aggregator's H3 cells (~500 m)
  per time window (openspec/architecture.md, "Agregador espacial" and
  Componente 3 table).
"""

from __future__ import annotations

import enum
import uuid
from datetime import datetime

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    DateTime,
    Enum,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.types import Uuid

from app.core.database import Base


class ReportSource(enum.Enum):
    """How a report was generated (scheduled cadence or manual button)."""

    SCHEDULED = "SCHEDULED"
    MANUAL = "MANUAL"


class Report(Base):
    __tablename__ = "reports"

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid, primary_key=True, default=uuid.uuid4
    )

    event_id: Mapped[str] = mapped_column(
        String, ForeignKey("events.event_id", ondelete="RESTRICT"), nullable=False
    )

    source: Mapped[ReportSource] = mapped_column(
        Enum(ReportSource, native_enum=False, length=16), nullable=False
    )

    # Validated LLM output. JSONB on PostgreSQL (PostgreSQL-only runtime).
    content: Mapped[dict] = mapped_column(JSONB, nullable=False)

    generated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    __table_args__ = (
        Index("ix_reports_event_id_generated_at", "event_id", "generated_at"),
    )


class ReceivedCell(Base):
    __tablename__ = "received_cells"

    id: Mapped[int] = mapped_column(
        BigInteger, primary_key=True, autoincrement=True
    )

    event_id: Mapped[str] = mapped_column(
        String,
        ForeignKey("events.event_id", ondelete="CASCADE"),
        nullable=False,
    )

    # 15-character H3 cell index (~500 m resolution).
    h3_index: Mapped[str] = mapped_column(String(15), nullable=False)

    window_start: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    window_end: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)

    person_count: Mapped[int] = mapped_column(Integer, nullable=False)
    # intensity = f(person_count, recency), computed upstream and cached.
    intensity: Mapped[float] = mapped_column(Float, nullable=False)

    __table_args__ = (
        CheckConstraint("window_start < window_end", name="ck_received_cells_window"),
        CheckConstraint("person_count >= 0", name="ck_received_cells_count_nonneg"),
        CheckConstraint("intensity >= 0", name="ck_received_cells_intensity_nonneg"),
        UniqueConstraint("event_id", "h3_index", "window_start"),
        Index("ix_received_cells_event_h3", "event_id", "h3_index"),
    )
