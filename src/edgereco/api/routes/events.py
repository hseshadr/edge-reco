"""Events endpoint: ingest interaction events, update session profile."""
from __future__ import annotations

import logging
from typing import Annotated, Any

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from edgereco.api.deps import Container, get_session_id
from edgereco.catalog.models import InteractionEvent
from edgereco.reco.signals import apply_interaction

logger = logging.getLogger(__name__)

router = APIRouter()


class EventsBody(BaseModel):
    events: list[InteractionEvent]


@router.post("/events")
def post_events(
    body: EventsBody,
    container: Container,
    session_id: Annotated[str, Depends(get_session_id)] = "",
) -> dict[str, Any]:
    for event in body.events:
        product = container.by_id.get(event.product_id)
        if product is None:
            logger.warning("unknown product_id in event: %s", event.product_id)
        else:
            container.sessions.update(
                session_id,
                lambda profile, p=product, et=event.event_type: apply_interaction(profile, p, et),  # type: ignore[misc]
            )
        container.events.append(event)
    return {"received": len(body.events)}
