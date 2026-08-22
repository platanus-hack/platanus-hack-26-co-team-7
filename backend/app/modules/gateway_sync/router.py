"""Authenticated private gateway ingestion independent from public records."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from app.database import get_session
from app.models.event import Event
from app.modules.gateway_sync.models import GatewayTelegramRecord, PersonState, PersonStatus
from app.modules.gateway_sync.schemas import TelegramBatchItemResult, TelegramBatchRequest, TelegramBatchResponse, TelegramInput
from app.modules.mobile_identity.models import MobileProfile
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


def _upsert_state(session: Session, user_id: str) -> PersonState:
    session.execute(insert(PersonState).values(user_id=user_id, current_status=PersonStatus.EMERGENCY).on_conflict_do_nothing(index_elements=[PersonState.user_id]))
    return session.execute(select(PersonState).where(PersonState.user_id == user_id).with_for_update()).scalar_one()


@router.post("/batch", response_model=TelegramBatchResponse)
def upload_batch(payload: Annotated[TelegramBatchRequest, Depends(_read_bounded_batch)], credentials=Depends(bearer_scheme), session: Session = Depends(get_session)) -> TelegramBatchResponse:
    gateway_user_id = require_user_id(credentials)
    results: list[TelegramBatchItemResult | None] = [None] * len(payload.items)
    valid_items: list[tuple[int, TelegramInput]] = []
    for index, item in enumerate(payload.items):
        try:
            valid_items.append((index, TelegramInput.model_validate(item)))
        except ValidationError:
            results[index] = TelegramBatchItemResult(index=index, id=_raw_id(item), outcome="invalid_payload")

    with session.begin():
        users = {profile.user_id: profile for profile in session.execute(select(MobileProfile).where(MobileProfile.user_id.in_({telegram.user_id for _, telegram in valid_items}))).scalars()}
        events = {event.event_id: event for event in session.execute(select(Event).where(Event.event_id.in_({telegram.event_id for _, telegram in valid_items}))).scalars()}
        for index, telegram in valid_items:
            if telegram.user_id not in users or telegram.event_id not in events or events[telegram.event_id].event_type.value != telegram.event.value:
                results[index] = TelegramBatchItemResult(index=index, id=str(telegram.id), outcome="invalid_payload")
                continue
            person_state = _upsert_state(session, telegram.user_id)
            if telegram.status is PersonStatus.EMERGENCY and person_state.current_status is PersonStatus.SAFE:
                results[index] = TelegramBatchItemResult(index=index, id=str(telegram.id), outcome="ignored_safe")
                continue
            inserted_id = session.execute(insert(GatewayTelegramRecord).values(id=telegram.id, event_id=telegram.event_id, user_id=telegram.user_id, gateway_user_id=gateway_user_id, status=telegram.status, event_type=telegram.event, lat=telegram.location.lat, lng=telegram.location.lng, origin_ts=_timestamp(telegram.timestamp), severity=telegram.severity, hop=telegram.hop, ttl=telegram.ttl, origin_device=telegram.origin, hmac_signature=telegram.hmac, question_id=telegram.verify.question_id if telegram.verify else None, answer_hash=telegram.verify.answer_hash if telegram.verify else None, payload=telegram.model_dump(mode="json")).on_conflict_do_nothing(index_elements=[GatewayTelegramRecord.id]).returning(GatewayTelegramRecord.id)).scalar_one_or_none()
            if inserted_id is None:
                results[index] = TelegramBatchItemResult(index=index, id=str(telegram.id), outcome="duplicate")
                continue
            person = users[telegram.user_id]
            if telegram.status is PersonStatus.SAFE:
                if telegram.verify is None or telegram.verify.question_id != person.question_id or telegram.verify.answer_hash.casefold() != person.answer_hash.casefold():
                    results[index] = TelegramBatchItemResult(index=index, id=str(telegram.id), outcome="invalid_safe_verification")
                    continue
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
