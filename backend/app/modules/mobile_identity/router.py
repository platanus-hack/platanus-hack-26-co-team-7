"""Private v1 registration, session management, and profile endpoints."""

from __future__ import annotations

import secrets
import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import delete, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.database import get_session
from app.modules.mobile_identity.config import settings
from app.modules.mobile_identity.models import MobileEmergencyContact, MobileProfile, RefreshSession, UserCredential
from app.modules.mobile_identity.profile import current_person, profile_response
from app.modules.mobile_identity.schemas import (
    LoginRequest,
    ProfileFields,
    ProfileResponse,
    RefreshRequest,
    RegisterRequest,
    TokenPair,
)
from app.modules.mobile_identity.security import (
    create_access_token,
    hash_password,
    hash_refresh_token,
    new_refresh_token,
    refresh_expiry,
    utcnow,
    verify_password,
)

router = APIRouter()
auth_router = APIRouter(prefix="/api/v1/private/auth", tags=["private-auth"])
profile_router = APIRouter(prefix="/api/v1/private/profile", tags=["private-profile"])


def _issue_tokens(session: Session, user_id: str) -> TokenPair:
    session_id = uuid.uuid4()
    refresh_token = new_refresh_token(session_id)
    session.add(
        RefreshSession(
            id=session_id,
            user_id=user_id,
            token_hash=hash_refresh_token(refresh_token),
            expires_at=refresh_expiry(),
        )
    )
    return TokenPair(
        access_token=create_access_token(user_id),
        refresh_token=refresh_token,
        expires_in=settings.access_token_ttl_seconds,
    )


def _invalid_login() -> HTTPException:
    return HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials.")


def _invalid_refresh() -> HTTPException:
    return HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired refresh token.")


@auth_router.post("/register", response_model=ProfileResponse, status_code=status.HTTP_201_CREATED)
def register(payload: RegisterRequest, session: Session = Depends(get_session)) -> ProfileResponse:
    user_id = str(uuid.uuid4())
    person_values = payload.model_dump(exclude={"password", "emergency_contacts"})
    person = MobileProfile(
        user_id=user_id,
        **person_values,
        device_secret=secrets.token_urlsafe(48),
    )
    session.add(person)
    session.add(UserCredential(user_id=user_id, password_hash=hash_password(payload.password)))
    session.add_all(
        [MobileEmergencyContact(user_id=user_id, **contact.model_dump()) for contact in payload.emergency_contacts]
    )
    try:
        session.commit()
    except IntegrityError as error:
        session.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Document is already registered.") from error
    return profile_response(person, session.execute(
        select(MobileEmergencyContact).where(MobileEmergencyContact.user_id == user_id)
    ).scalars().all())


@auth_router.post("/login", response_model=TokenPair)
def login(payload: LoginRequest, session: Session = Depends(get_session)) -> TokenPair:
    row = session.execute(
        select(MobileProfile, UserCredential)
        .join(UserCredential, UserCredential.user_id == MobileProfile.user_id)
        .where(MobileProfile.doc_type == payload.doc_type, MobileProfile.doc_number == payload.doc_number)
    ).one_or_none()
    if row is None or not verify_password(payload.password, row.UserCredential.password_hash):
        raise _invalid_login()
    tokens = _issue_tokens(session, row.MobileProfile.user_id)
    session.commit()
    return tokens


@auth_router.post("/refresh", response_model=TokenPair)
def refresh(payload: RefreshRequest, session: Session = Depends(get_session)) -> TokenPair:
    try:
        session_id = uuid.UUID(payload.refresh_token.split(".", maxsplit=1)[0])
    except (ValueError, IndexError):
        raise _invalid_refresh()
    refresh_session = session.get(RefreshSession, session_id)
    if (
        refresh_session is None
        or refresh_session.revoked_at is not None
        or refresh_session.expires_at <= utcnow()
        or not secrets.compare_digest(refresh_session.token_hash, hash_refresh_token(payload.refresh_token))
    ):
        raise _invalid_refresh()
    refresh_session.revoked_at = utcnow()
    tokens = _issue_tokens(session, refresh_session.user_id)
    session.commit()
    return tokens


@auth_router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(payload: RefreshRequest, session: Session = Depends(get_session)) -> None:
    try:
        session_id = uuid.UUID(payload.refresh_token.split(".", maxsplit=1)[0])
    except (ValueError, IndexError):
        return None
    refresh_session = session.get(RefreshSession, session_id)
    if refresh_session and secrets.compare_digest(
        refresh_session.token_hash, hash_refresh_token(payload.refresh_token)
    ):
        refresh_session.revoked_at = utcnow()
        session.commit()
    return None


@profile_router.get("", response_model=ProfileResponse)
def get_profile(person: MobileProfile = Depends(current_person), session: Session = Depends(get_session)) -> ProfileResponse:
    contacts = session.execute(
        select(MobileEmergencyContact).where(MobileEmergencyContact.user_id == person.user_id)
    ).scalars().all()
    return profile_response(person, contacts)


@profile_router.put("", response_model=ProfileResponse)
def update_profile(
    payload: ProfileFields,
    person: MobileProfile = Depends(current_person),
    session: Session = Depends(get_session),
) -> ProfileResponse:
    for field, value in payload.model_dump(exclude={"emergency_contacts"}).items():
        setattr(person, field, value)
    session.execute(delete(MobileEmergencyContact).where(MobileEmergencyContact.user_id == person.user_id))
    session.add_all(
        [
            MobileEmergencyContact(user_id=person.user_id, **contact.model_dump())
            for contact in payload.emergency_contacts
        ]
    )
    try:
        session.commit()
    except IntegrityError as error:
        session.rollback()
        raise HTTPException(status_code=409, detail="Document is already registered.") from error
    session.refresh(person)
    return profile_response(person, session.execute(
        select(MobileEmergencyContact).where(MobileEmergencyContact.user_id == person.user_id)
    ).scalars().all())


router.include_router(auth_router)
router.include_router(profile_router)
