"""Authenticated, flag-gated activation endpoint used only by the mobile demo."""

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, Header, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.config import settings as core_settings
from app.core.database import get_session
from app.models.event import EventType
from app.modules.event_activation.service import activate_event
from app.modules.mobile_identity.config import settings
from app.modules.mobile_identity.security import bearer_scheme, require_user_id, utcnow

logger = logging.getLogger(__name__)

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


# ---------------------------------------------------------------------------
# Public web demo trigger
# ---------------------------------------------------------------------------
# Separate router: this one is anonymous, so it cannot live under the /private
# prefix above. It exists so a presenter can stand in for the EMSC/SGC pollers
# from the web dashboard, and it is gated by its own flag (off by default).
web_router = APIRouter(prefix="/api/v1/demo", tags=["public-demo"])


class WebTriggerResponse(BaseModel):
    event_id: str
    mag: float
    place: str
    cells: int


# What the button announces. EMSC/SGC would carry the real values here; for a
# simulation they are fixed so the narration on stage stays predictable.
_DEMO_MAG = 5.6
_DEMO_PLACE = "Bogotá D.C., Cundinamarca"


@web_router.post("/trigger", response_model=WebTriggerResponse)
async def trigger_web_demo() -> WebTriggerResponse:
    """Rebuild the demo event and announce it exactly like a real trigger does.

    Reuses ``scripts.seed_demo.seed`` (idempotent by design D3) instead of
    inventing a second data path: that rebuild is what gives the event its H3
    cells, which in turn is what lets the AI report scheduler produce a report.
    Then it broadcasts ``EVENT_OPENED`` — the piece ``activate_event`` does not
    do and each poller performs itself — so every connected dashboard reacts.
    """
    from app.core.ws import manager as ws_manager
    from scripts.seed_demo import DEMO_EVENT_ID, seed

    if not core_settings.demo_web_trigger_enabled:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Web demo trigger is disabled."
        )

    counts = seed()

    try:
        await ws_manager.broadcast(
            {
                "type": "EVENT_OPENED",
                "event_id": DEMO_EVENT_ID,
                "mag": _DEMO_MAG,
                "place": _DEMO_PLACE,
            }
        )
    except Exception:  # noqa: BLE001 - a WS failure must not lose the activation
        logger.exception("web demo trigger: EVENT_OPENED broadcast failed")

    return WebTriggerResponse(
        event_id=DEMO_EVENT_ID,
        mag=_DEMO_MAG,
        place=_DEMO_PLACE,
        cells=counts["cells"],
    )
