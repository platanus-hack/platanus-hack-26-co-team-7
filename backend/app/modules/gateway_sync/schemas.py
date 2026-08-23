"""Wire schemas for authenticated private gateway synchronization."""

from __future__ import annotations

from typing import Annotated, Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.modules.gateway_sync.models import GatewayEventType, PersonStatus
from app.modules.mobile_identity.models import Disability

MedicalText = Annotated[str, Field(min_length=1, max_length=300, strip_whitespace=True)]


class TelegramLocation(BaseModel):
    model_config = ConfigDict(extra="forbid")

    lat: Annotated[float, Field(ge=-90, le=90)]
    lng: Annotated[float, Field(ge=-180, le=180)]


class TelegramVital(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: Annotated[str | None, Field(min_length=1, max_length=160, strip_whitespace=True)] = None
    age: Annotated[int | None, Field(ge=0, le=130)] = None
    blood: Annotated[str | None, Field(pattern=r"^(A|B|AB|O)[+-]$")] = None
    allergies: list[MedicalText] = Field(default_factory=list, max_length=25)
    conditions: list[MedicalText] = Field(default_factory=list, max_length=25)
    medications: list[MedicalText] = Field(default_factory=list, max_length=25)
    disability: Disability = Disability.NONE
    pregnant: bool = False


class TelegramVerify(BaseModel):
    model_config = ConfigDict(extra="forbid")

    question_id: Annotated[str, Field(min_length=1, max_length=128, strip_whitespace=True)]
    answer_hash: Annotated[str, Field(pattern=r"^[A-Fa-f0-9]{64}$")]


class TelegramInput(BaseModel):
    """Wire schema accepted from a mobile gateway, independent of its owner."""

    model_config = ConfigDict(extra="forbid")

    v: Literal[2]
    id: UUID
    user_id: Annotated[str, Field(min_length=1, max_length=128, strip_whitespace=True)]
    event_id: Annotated[str, Field(min_length=1, max_length=128, strip_whitespace=True)]
    event: GatewayEventType
    status: PersonStatus
    severity: Annotated[int, Field(ge=1, le=5)]
    location: TelegramLocation
    timestamp: Annotated[int, Field(ge=0, le=4_102_444_800)]
    hop: Annotated[int, Field(ge=0, le=255)]
    ttl: Annotated[int, Field(ge=0, le=8)]
    origin: Annotated[str, Field(min_length=1, max_length=128, strip_whitespace=True)]
    key_id: Annotated[str, Field(pattern=r"^[A-Fa-f0-9]{64}$")]
    public_key: Annotated[str, Field(min_length=100, max_length=2048)]
    signature: Annotated[str, Field(min_length=64, max_length=1024)]
    vital: TelegramVital | None = None
    verify: TelegramVerify | None = None

    @field_validator("id")
    @classmethod
    def id_must_be_v4(cls, value: UUID) -> UUID:
        if value.version != 4:
            raise ValueError("id must be a UUID v4")
        return value


class TelegramBatchRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    items: list[Any] = Field(min_length=1, max_length=100)


class TelegramBatchItemResult(BaseModel):
    index: int
    id: str | None = None
    outcome: Literal[
        "accepted",
        "duplicate",
        "ignored_safe",
        "invalid_safe_verification",
        "invalid_payload",
        "invalid_signature",
        "legacy_requires_resign",
    ]


class TelegramBatchResponse(BaseModel):
    results: list[TelegramBatchItemResult]
