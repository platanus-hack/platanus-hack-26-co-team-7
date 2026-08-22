"""Profile serialization and authenticated-person dependencies."""

from __future__ import annotations

from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials
from sqlalchemy.orm import Session

from app.database import get_session
from app.modules.mobile_identity.models import MobileEmergencyContact, MobileProfile
from app.modules.mobile_identity.schemas import ProfileResponse
from app.modules.mobile_identity.security import bearer_scheme, require_user_id


def profile_response(person: MobileProfile, contacts: list[MobileEmergencyContact]) -> ProfileResponse:
    return ProfileResponse(
        user_id=person.user_id,
        full_name=person.full_name,
        doc_type=person.doc_type,
        doc_number=person.doc_number,
        birth_date=person.birth_date,
        blood_type=person.blood_type,
        blood_rh=person.blood_rh,
        allergies=person.allergies,
        chronic_conditions=person.chronic_conditions,
        medications=person.medications or [],
        disability=person.disability,
        is_pregnant=person.is_pregnant,
        weight_kg=person.weight_kg,
        eps=person.eps,
        emergency_contacts=[
            {"name": contact.name, "phone": contact.phone, "relationship": contact.relationship}
            for contact in contacts
        ],
        question_id=person.question_id,
        answer_hash=person.answer_hash,
    )


def current_person(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    session: Session = Depends(get_session),
) -> MobileProfile:
    person = session.get(MobileProfile, require_user_id(credentials))
    if person is None:
        raise HTTPException(status_code=401, detail="Authentication subject no longer exists.")
    return person
