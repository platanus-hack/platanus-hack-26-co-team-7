"""Authenticated private gateway ingestion independent from public records."""

from __future__ import annotations

from datetime import UTC, datetime
import base64
import hashlib
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import ValidationError
from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from app.core.database import get_session
from app.models.event import Event
from app.modules.gateway_sync.models import GatewayTelegramRecord, PersonState, PersonStatus
from app.modules.gateway_sync.schemas import TelegramBatchItemResult, TelegramBatchRequest, TelegramBatchResponse, TelegramInput
from app.modules.mobile_identity.models import DeviceIdentity, MobileProfile
from app.modules.mobile_identity.security import bearer_scheme, require_user_id

router = APIRouter(prefix="/api/v1/private/telegrams", tags=["private-telegrams"])
MAX_BATCH_BYTES = 512 * 1024


async def _read_bounded_batch(request: Request) -> TelegramBatchRequest:
    content_length = request.headers.get("content-length")
    if content_length is not None:
        try:
            if int(content_length) > MAX_BATCH_BYTES:
                raise HTTPException(status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE)
        except ValueError as error:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid Content-Length.") from error
    body = await request.body()
    if len(body) > MAX_BATCH_BYTES:
        raise HTTPException(status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE)
    try:
        return TelegramBatchRequest.model_validate_json(body)
    except ValidationError as error:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=error.errors()) from error


def _raw_id(value: object) -> str | None:
    return value.get("id") if isinstance(value, dict) and isinstance(value.get("id"), str) else None


def _timestamp(value: int) -> datetime:
    return datetime.fromtimestamp(value, UTC)


def _upsert_state(session: Session, user_id: str, event_id: str) -> PersonState:
    session.execute(insert(PersonState).values(user_id=user_id, event_id=event_id, current_status=PersonStatus.EMERGENCY).on_conflict_do_nothing(index_elements=[PersonState.event_id, PersonState.user_id]))
    return session.execute(select(PersonState).where(PersonState.user_id == user_id, PersonState.event_id == event_id).with_for_update()).scalar_one()


def _canonical(telegram: TelegramInput) -> bytes:
    null = "\x00"
    def field(value: object | None) -> str: return null if value is None else str(value)
    def texts(values: list[str]) -> str: return ",".join(sorted(values))
    vital = telegram.vital
    verify = telegram.verify
    fields = [telegram.v, telegram.id, telegram.user_id, telegram.event_id, telegram.event.value, telegram.status.value, telegram.severity,
              f"{telegram.location.lat:.6f}", f"{telegram.location.lng:.6f}", telegram.timestamp, telegram.origin]
    fields += [null] if vital is None else [vital.name, vital.age, vital.blood, texts(vital.allergies), texts(vital.conditions), texts(vital.medications), vital.disability.value, str(vital.pregnant).lower()]
    fields += [null] if verify is None else [verify.question_id, verify.answer_hash]
    fields += [telegram.key_id, telegram.public_key]
    return ("\x1f".join(field(value) for value in fields) + "\x1f").encode()


def _valid_signature(telegram: TelegramInput) -> bool:
    try:
        public_bytes = base64.b64decode(telegram.public_key, validate=True)
        if hashlib.sha256(public_bytes).hexdigest() != telegram.key_id.casefold(): return False
        public_key = serialization.load_der_public_key(public_bytes)
        if not isinstance(public_key, ec.EllipticCurvePublicKey): return False
        public_key.verify(base64.b64decode(telegram.signature, validate=True), _canonical(telegram), ec.ECDSA(hashes.SHA256()))
        return True
    except (ValueError, TypeError, InvalidSignature): return False


@router.post("/batch", response_model=TelegramBatchResponse)
def upload_batch(payload: Annotated[TelegramBatchRequest, Depends(_read_bounded_batch)], credentials=Depends(bearer_scheme), session: Session = Depends(get_session)) -> TelegramBatchResponse:
    gateway_user_id = require_user_id(credentials)
    results: list[TelegramBatchItemResult | None] = [None] * len(payload.items)
    valid_items: list[tuple[int, TelegramInput]] = []
    for index, item in enumerate(payload.items):
        try:
            valid_items.append((index, TelegramInput.model_validate(item)))
        except ValidationError:
            outcome = "legacy_requires_resign" if isinstance(item, dict) and item.get("v") == 1 else "invalid_payload"
            results[index] = TelegramBatchItemResult(index=index, id=_raw_id(item), outcome=outcome)

    with session.begin():
        users = {profile.user_id: profile for profile in session.execute(select(MobileProfile).where(MobileProfile.user_id.in_({telegram.user_id for _, telegram in valid_items}))).scalars()}
        events = {event.event_id: event for event in session.execute(select(Event).where(Event.event_id.in_({telegram.event_id for _, telegram in valid_items}))).scalars()}
        for index, telegram in valid_items:
            if telegram.event_id not in events or events[telegram.event_id].event_type.value != telegram.event.value:
                results[index] = TelegramBatchItemResult(index=index, id=str(telegram.id), outcome="invalid_payload")
                continue
            if not _valid_signature(telegram):
                results[index] = TelegramBatchItemResult(index=index, id=str(telegram.id), outcome="invalid_signature")
                continue
            identity = session.get(DeviceIdentity, telegram.key_id.casefold())
            if identity is None or identity.revoked_at is not None or identity.user_id is None or identity.public_key != telegram.public_key:
                results[index] = TelegramBatchItemResult(index=index, id=str(telegram.id), outcome="invalid_signature")
                continue
            if telegram.status is PersonStatus.SAFE:
                person = users.get(telegram.user_id)
                if person is None or telegram.verify is None or telegram.verify.question_id != person.question_id or telegram.verify.answer_hash.casefold() != person.answer_hash.casefold():
                    results[index] = TelegramBatchItemResult(index=index, id=str(telegram.id), outcome="invalid_safe_verification")
                    continue
            elif identity.user_id != telegram.user_id:
                # Only the affected user's registered device can assert EMERGENCY/NEED_HELP.
                results[index] = TelegramBatchItemResult(index=index, id=str(telegram.id), outcome="invalid_signature")
                continue
            person_state = _upsert_state(session, telegram.user_id, telegram.event_id)
            if person_state.current_status is PersonStatus.SAFE and telegram.status in {PersonStatus.EMERGENCY, PersonStatus.NEED_HELP}:
                results[index] = TelegramBatchItemResult(index=index, id=str(telegram.id), outcome="ignored_safe")
                continue
            if person_state.current_status is PersonStatus.SAFE and telegram.status is PersonStatus.SAFE:
                results[index] = TelegramBatchItemResult(index=index, id=str(telegram.id), outcome="ignored_safe")
                continue
            inserted_id = session.execute(insert(GatewayTelegramRecord).values(id=telegram.id, event_id=telegram.event_id, user_id=telegram.user_id, gateway_user_id=gateway_user_id, status=telegram.status, event_type=telegram.event, lat=telegram.location.lat, lng=telegram.location.lng, origin_ts=_timestamp(telegram.timestamp), severity=telegram.severity, hop=telegram.hop, ttl=telegram.ttl, origin_device=telegram.origin, key_id=telegram.key_id.casefold(), signature=telegram.signature, question_id=telegram.verify.question_id if telegram.verify else None, answer_hash=telegram.verify.answer_hash if telegram.verify else None, payload=telegram.model_dump(mode="json")).on_conflict_do_nothing(index_elements=[GatewayTelegramRecord.id]).returning(GatewayTelegramRecord.id)).scalar_one_or_none()
            if inserted_id is None:
                results[index] = TelegramBatchItemResult(index=index, id=str(telegram.id), outcome="duplicate")
                continue
            if telegram.status is PersonStatus.SAFE:
                person_state.current_status = PersonStatus.SAFE
                person_state.safe_at = _timestamp(telegram.timestamp)
            elif telegram.status is PersonStatus.NEED_HELP:
                if person_state.current_status is not PersonStatus.SAFE:
                    person_state.current_status = PersonStatus.NEED_HELP
            elif person_state.emergency_timestamp is None or _timestamp(telegram.timestamp) >= person_state.emergency_timestamp:
                person_state.emergency_status = PersonStatus.EMERGENCY
                person_state.emergency_lat = telegram.location.lat
                person_state.emergency_lng = telegram.location.lng
                person_state.emergency_timestamp = _timestamp(telegram.timestamp)
            person_state.last_telegram_id = telegram.id
            results[index] = TelegramBatchItemResult(index=index, id=str(telegram.id), outcome="accepted")
    return TelegramBatchResponse(results=[result for result in results if result is not None])
