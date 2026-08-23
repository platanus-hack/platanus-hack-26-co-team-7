"""Private read-only active event lookup for mobile telegram composition."""

from datetime import datetime

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.database import get_session
from app.models.event import Event
from app.modules.mobile_identity.security import bearer_scheme, require_user_id

router = APIRouter(prefix="/api/v1/private/events", tags=["private-events"])


class ActiveEventResponse(BaseModel):
    event_id: str
    event: str
    occurred_at: datetime
    activation_revision: int
    activation_source: str | None


@router.get("/active", response_model=list[ActiveEventResponse])
def active_events(credentials=Depends(bearer_scheme), session: Session = Depends(get_session)) -> list[ActiveEventResponse]:
    require_user_id(credentials)
    events = session.execute(
        select(Event).where(Event.closed_at.is_(None)).order_by(Event.occurred_at.desc())
    ).scalars()
    return [ActiveEventResponse(event_id=event.event_id, event=event.event_type.value, occurred_at=event.occurred_at, activation_revision=event.activation_revision, activation_source=event.activation_source) for event in events]
