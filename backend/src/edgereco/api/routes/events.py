"""Events endpoint: ingest interaction events, update session profile."""

from __future__ import annotations

import logging
import secrets
from collections.abc import Callable
from typing import Annotated, Final

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel, Field
from pydantic_settings import BaseSettings

from edgereco.api.deps import Container, get_session_id
from edgereco.api.models import EngagementExport, EventsResponse
from edgereco.catalog.models import EventType, InteractionEvent, Product, SessionProfile
from edgereco.reco.retrain import aggregate_engagement
from edgereco.reco.signals import apply_interaction

logger = logging.getLogger(__name__)

router = APIRouter()

# Reject oversized beacon batches at the Pydantic boundary (demo collector hardening).
MAX_EVENTS_PER_BATCH: Final[int] = 1000

_BEARER_PREFIX: Final[str] = "Bearer "


class _EventsAuthSettings(BaseSettings):
    """Optional fail-closed shared key for the demo collector.

    Unset (``None``) leaves ``/events`` + ``/events/export`` OPEN so the tokenless
    demo flywheel keeps working; set ``EDGERECO_EVENTS_TOKEN`` to require a matching
    ``Authorization: Bearer <token>``.
    """

    model_config = {"env_prefix": "EDGERECO_"}

    events_token: str | None = None


def _bearer_token(authorization: str | None) -> str | None:
    """Extract the bearer credential from an ``Authorization`` header, if present."""
    if authorization is None or not authorization.startswith(_BEARER_PREFIX):
        return None
    return authorization[len(_BEARER_PREFIX) :]


def require_events_token(
    authorization: Annotated[str | None, Header()] = None,
) -> None:
    """Fail-closed shared-key guard. Open when ``EDGERECO_EVENTS_TOKEN`` is unset."""
    expected = _EventsAuthSettings().events_token
    if expected is None:
        return
    presented = _bearer_token(authorization)
    if presented is None or not secrets.compare_digest(presented, expected):
        raise HTTPException(status_code=401, detail="invalid or missing events token")


class EventsBody(BaseModel):
    events: list[InteractionEvent] = Field(max_length=MAX_EVENTS_PER_BATCH)
    # Optional in-body session id for the beacon uplink: navigator.sendBeacon
    # cannot set an X-Session-Id header, so the client folds it into the payload.
    # When present it wins over the header; absent, the header path is unchanged.
    session_id: str | None = None


@router.post("/events", response_model=EventsResponse, dependencies=[Depends(require_events_token)])
def post_events(
    body: EventsBody,
    container: Container,
    session_id: Annotated[str, Depends(get_session_id)] = "",
) -> EventsResponse:
    effective_session = body.session_id or session_id
    for event in body.events:
        product = container.by_id.get(event.product_id)
        if product is None:
            logger.warning("unknown product_id in event: %s", event.product_id)
        else:
            container.sessions.update(effective_session, _updater(product, event.event_type))
        container.events.append(event)
    return EventsResponse(received=len(body.events))


@router.get(
    "/events/export",
    response_model=EngagementExport,
    dependencies=[Depends(require_events_token)],
)
def export_events(container: Container) -> EngagementExport:
    """Aggregate the buffered events into weighted engagement per product.

    The cloud retrain job reads this to recompute popularity. Read-only and off
    the inference path — it never touches search/recommend.
    """
    events = container.events.all()
    stats = aggregate_engagement(events)
    return EngagementExport(total_events=len(events), stats=list(stats.values()))


def _updater(product: Product, event_type: EventType) -> Callable[[SessionProfile], SessionProfile]:
    def update(profile: SessionProfile) -> SessionProfile:
        return apply_interaction(profile, product, event_type)

    return update
