"""EvidenceChunk model.

Implements "Patrón C" lazy evidence upload (openspec/api.md,
POST /api/evidence/:telegram_id): the origin uploads video/audio in chunks
once it regains Internet connectivity. Replaces the flat
``video_uploaded_at``/``video_url`` columns of the old messages sketch.
"""

from __future__ import annotations

import enum
import uuid
from datetime import datetime

from sqlalchemy import (
    CheckConstraint,
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

from app.core.database import Base


class EvidenceKind(enum.Enum):
    VIDEO = "VIDEO"
    AUDIO = "AUDIO"


class EvidenceChunk(Base):
    __tablename__ = "evidence_chunks"

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid, primary_key=True, default=uuid.uuid4
    )

    telegram_id: Mapped[uuid.UUID] = mapped_column(
        Uuid,
        ForeignKey("telegrams.id", ondelete="CASCADE"),
        nullable=False,
    )

    kind: Mapped[EvidenceKind] = mapped_column(
        Enum(EvidenceKind, native_enum=False, length=16), nullable=False
    )

    # chunk_index is 0-based and strictly less than total_chunks.
    chunk_index: Mapped[int] = mapped_column(Integer, nullable=False)
    total_chunks: Mapped[int] = mapped_column(Integer, nullable=False)

    sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    size_bytes: Mapped[int] = mapped_column(Integer, nullable=False)

    storage_url: Mapped[str] = mapped_column(String, nullable=False)

    uploaded_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    __table_args__ = (
        CheckConstraint(
            "chunk_index >= 0 AND total_chunks >= 1 AND chunk_index < total_chunks",
            name="ck_evidence_chunks_chunk_bounds",
        ),
        UniqueConstraint("telegram_id", "kind", "chunk_index"),
    )
