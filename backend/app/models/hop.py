"""TelegramHop model.

Replaces the old ``message_path`` table from openspec/api.md: records each
mesh leg a telegram made (which peer delivered it, at which hop count),
enabling gateway path reconstruction A -> B -> C -> D -> Gateway
(openspec/protocol.md section 1, "origin" rationale).
"""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import (
    BigInteger,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.types import Uuid

from app.core.database import Base


class TelegramHop(Base):
    __tablename__ = "telegram_hops"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)

    telegram_id: Mapped[uuid.UUID] = mapped_column(
        Uuid,
        ForeignKey("telegrams.id", ondelete="CASCADE"),
        nullable=False,
    )

    peer_id: Mapped[str] = mapped_column(String, nullable=False)
    hop_at_peer: Mapped[int] = mapped_column(Integer, nullable=False)

    seen_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    __table_args__ = (
        UniqueConstraint(
            "telegram_id",
            "peer_id",
            "hop_at_peer",
            name="uq_telegram_hops_unique_leg",
        ),
        Index("ix_telegram_hops_telegram_id", "telegram_id"),
    )
