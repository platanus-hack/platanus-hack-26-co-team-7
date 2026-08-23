"""Private read-only active event lookup for mobile telegram composition."""

from datetime import datetime

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from app.core.database import get_session
from app.models.event import Event
from app.modules.gateway_sync.models import PersonState, PersonStatus
from app.modules.mobile_identity.security import bearer_scheme, require_user_id, utcnow

router = APIRouter(prefix="/api/v1/private/events", tags=["private-events"])


class ActiveEventResponse(BaseModel):
    event_id: str
    event: str
    occurred_at: datetime
    activation_revision: int
    activation_source: str | None


class StatusReport(BaseModel):
    event_id: str
    status: PersonStatus
    lat: float = Field(ge=-90, le=90)
    lng: float = Field(ge=-180, le=180)


class StatusReportResponse(BaseModel):
    ok: bool = True


@router.get("/active", response_model=list[ActiveEventResponse])
def active_events(credentials=Depends(bearer_scheme), session: Session = Depends(get_session)) -> list[ActiveEventResponse]:
    require_user_id(credentials)
    events = session.execute(
        select(Event).where(Event.closed_at.is_(None)).order_by(Event.occurred_at.desc())
    ).scalars()
    return [ActiveEventResponse(event_id=event.event_id, event=event.event_type.value, occurred_at=event.occurred_at, activation_revision=event.activation_revision, activation_source=event.activation_source) for event in events]


@router.post("/status", response_model=StatusReportResponse)
def report_status(payload: StatusReport, credentials=Depends(bearer_scheme), session: Session = Depends(get_session)) -> StatusReportResponse:
    user_id = require_user_id(credentials)
    now = utcnow()
    stmt = insert(PersonState).values(
        event_id=payload.event_id,
        user_id=user_id,
        current_status=payload.status,
        emergency_status=payload.status,
        emergency_lat=payload.lat,
        emergency_lng=payload.lng,
        emergency_timestamp=now,
        safe_at=now if payload.status == PersonStatus.SAFE else None,
        updated_at=now,
    ).on_conflict_do_update(
        constraint="uq_gateway_sync_person_states_event_user",
        set_={
            "current_status": payload.status,
            "emergency_status": payload.status,
            "emergency_lat": payload.lat,
            "emergency_lng": payload.lng,
            "emergency_timestamp": now,
            "safe_at": now if payload.status == PersonStatus.SAFE else None,
            "updated_at": now,
        },
    )
    session.execute(stmt)
    session.commit()
    return StatusReportResponse()
