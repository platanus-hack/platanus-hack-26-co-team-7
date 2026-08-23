"""Authenticated, flag-gated activation endpoint used only by the mobile demo."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Header, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.database import get_session
from app.models.event import EventType
from app.modules.event_activation.service import activate_event
from app.modules.mobile_identity.config import settings
from app.modules.mobile_identity.security import bearer_scheme, require_user_id, utcnow

router = APIRouter(prefix="/api/v1/private/demo/events", tags=["private-demo-events"])


class ActivationResponse(BaseModel):
    event_id: str
    event: EventType
    activation_revision: int
    activation_source: str


@router.post("/activate", response_model=ActivationResponse)
async def activate_demo_event(
    idempotency_key: str = Header(min_length=1, max_length=256),
    credentials=Depends(bearer_scheme),
    session: Session = Depends(get_session),
) -> ActivationResponse:
    actor_id = require_user_id(credentials)
    if not settings.demo_trigger_enabled:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Demo trigger is disabled.")
    with session.begin():
        result = activate_event(
            session,
            event_id="DEMO-EMERGENCY-BOGOTA",
            event_type=EventType.EARTHQUAKE,
            occurred_at=utcnow(),
            source="demo",
            source_key=f"{actor_id}:{idempotency_key}",
            actor_id=actor_id,
            audit_metadata={"kind": "mobile_demo"},
        )
    # The transaction is committed before this response makes the activation visible.
    return ActivationResponse(
        event_id=result.event.event_id,
        event=result.event.event_type,
        activation_revision=result.event.activation_revision,
        activation_source=result.event.activation_source or "demo",
    )
