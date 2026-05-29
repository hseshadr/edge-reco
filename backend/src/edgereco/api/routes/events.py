"""Events endpoint: ingest interaction events, update session profile."""

from __future__ import annotations

import logging
from collections.abc import Callable
from typing import Annotated

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from edgereco.api.deps import Container, get_session_id
from edgereco.api.models import EventsResponse
from edgereco.catalog.models import EventType, InteractionEvent, Product, SessionProfile
from edgereco.reco.signals import apply_interaction

logger = logging.getLogger(__name__)

router = APIRouter()


class EventsBody(BaseModel):
    events: list[InteractionEvent]


@router.post("/events", response_model=EventsResponse)
def post_events(
    body: EventsBody,
    container: Container,
    session_id: Annotated[str, Depends(get_session_id)] = "",
) -> EventsResponse:
    for event in body.events:
        product = container.by_id.get(event.product_id)
        if product is None:
            logger.warning("unknown product_id in event: %s", event.product_id)
        else:
            container.sessions.update(session_id, _updater(product, event.event_type))
        container.events.append(event)
    return EventsResponse(received=len(body.events))


def _updater(product: Product, event_type: EventType) -> Callable[[SessionProfile], SessionProfile]:
    def update(profile: SessionProfile) -> SessionProfile:
        return apply_interaction(profile, product, event_type)

    return update
