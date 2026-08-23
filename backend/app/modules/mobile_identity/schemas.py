"""Request and response schemas for private mobile identity endpoints."""

from __future__ import annotations

from datetime import date
from typing import Annotated

from pydantic import BaseModel, Field, field_validator, model_validator

from app.modules.mobile_identity.models import BloodRh, BloodType, Disability, DocType

ShortText = Annotated[str, Field(min_length=1, max_length=120, strip_whitespace=True)]
MedicalText = Annotated[str, Field(min_length=1, max_length=300, strip_whitespace=True)]


class EmergencyContactInput(BaseModel):
    name: ShortText
    phone: Annotated[str, Field(pattern=r"^\+?[1-9]\d{7,14}$")]
    relationship: ShortText


class ProfileFields(BaseModel):
    full_name: Annotated[str, Field(min_length=2, max_length=160, strip_whitespace=True)]
    doc_type: DocType
    doc_number: Annotated[str, Field(pattern=r"^[A-Za-z0-9.-]{3,30}$")]
    birth_date: date
    blood_type: BloodType
    blood_rh: BloodRh
    allergies: list[MedicalText] = Field(default_factory=list, max_length=25)
    chronic_conditions: list[MedicalText] = Field(default_factory=list, max_length=25)
    medications: list[MedicalText] = Field(default_factory=list, max_length=25)
    disability: Disability = Disability.NONE
    is_pregnant: bool = False
    weight_kg: Annotated[int | None, Field(ge=1, le=500)] = None
    eps: Annotated[str | None, Field(max_length=160, strip_whitespace=True)] = None
    emergency_contacts: list[EmergencyContactInput] = Field(default_factory=list, max_length=10)
    question_id: Annotated[str, Field(min_length=1, max_length=128, strip_whitespace=True)]
    answer_hash: Annotated[str, Field(pattern=r"^[A-Fa-f0-9]{64}$")]
    device_identity: "DeviceIdentityInput | None" = None

    @field_validator("allergies", "chronic_conditions", "medications")
    @classmethod
    def items_must_be_unique(cls, value: list[str]) -> list[str]:
        if len({item.casefold() for item in value}) != len(value):
            raise ValueError("list entries must be unique")
        return value

    @field_validator("emergency_contacts")
    @classmethod
    def contacts_must_be_unique(cls, value: list[EmergencyContactInput]) -> list[EmergencyContactInput]:
        if len({contact.phone for contact in value}) != len(value):
            raise ValueError("emergency contact phone numbers must be unique")
        return value

    @model_validator(mode="after")
    def birth_date_must_be_past(self) -> "ProfileFields":
        if self.birth_date >= date.today():
            raise ValueError("birth_date must be in the past")
        return self


class DeviceIdentityInput(BaseModel):
    key_id: Annotated[str, Field(pattern=r"^[A-Fa-f0-9]{64}$")]
    public_key: Annotated[str, Field(min_length=100, max_length=2048)]
    binding_proof: Annotated[str, Field(min_length=32, max_length=1024)]


class RegisterRequest(ProfileFields):
    password: Annotated[str, Field(min_length=12, max_length=128)]
    device_identity: DeviceIdentityInput


class UpdateProfileRequest(ProfileFields):
    """Authenticated profile edits may retain the existing SAFE answer hash."""

    answer_hash: Annotated[str | None, Field(pattern=r"^[A-Fa-f0-9]{64}$")] = None


class LoginRequest(BaseModel):
    doc_type: DocType
    doc_number: Annotated[str, Field(pattern=r"^[A-Za-z0-9.-]{3,30}$")]
    password: Annotated[str, Field(min_length=1, max_length=128)]


class RefreshRequest(BaseModel):
    refresh_token: Annotated[str, Field(min_length=40, max_length=512)]


class TokenPair(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_in: int
    refresh_token: str


class ProfileResponse(ProfileFields):
    user_id: str
