"""Events endpoint: ingest interaction events, update session profile."""

from __future__ import annotations

import logging
import secrets
from collections.abc import Callable
from typing import Annotated, Final

from fastapi import APIRouter, Depends, Header, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field
from pydantic_settings import BaseSettings, SettingsConfigDict
from starlette.datastructures import State

from edgereco.api.deps import Container, ServiceContainer, get_session_id
from edgereco.api.models import EngagementExport, EventsResponse
from edgereco.catalog.models import EventType, InteractionEvent, Product, SessionProfile
from edgereco.reco.ranking_config import InteractionWeights
from edgereco.reco.retrain import aggregate_engagement
from edgereco.reco.signals import apply_interaction

logger = logging.getLogger(__name__)

router = APIRouter()

# Reject oversized beacon batches at the Pydantic boundary (demo collector hardening).
MAX_EVENTS_PER_BATCH: Final[int] = 1000
# Cap the optional in-body session id so a malicious beacon cannot wedge an
# unbounded string into the default-open collector's session store.
MAX_SESSION_ID_LEN: Final[int] = 200

_BEARER_PREFIX: Final[str] = "Bearer "
# Per-app cache slot for the resolved shared key (env read once, then reused).
_AUTH_CACHE_ATTR: Final[str] = "_edgereco_events_authcache"
_UNSET: Final[object] = object()


class _EventsAuthSettings(BaseSettings):
    """Optional fail-closed shared key for the demo collector.

    Unset (``None``) leaves ``/events`` + ``/events/export`` OPEN so the tokenless
    demo flywheel keeps working; set ``EDGERECO_EVENTS_TOKEN`` to require a matching
    ``Authorization: Bearer <token>``.
    """

    model_config = SettingsConfigDict(env_prefix="EDGERECO_")

    events_token: str | None = None


def _bearer_token(authorization: str | None) -> str | None:
    """Extract the bearer credential from an ``Authorization`` header, if present."""
    if authorization is None or not authorization.startswith(_BEARER_PREFIX):
        return None
    return authorization[len(_BEARER_PREFIX) :]


def _expected_token(state: State) -> str | None:
    """Resolve the shared key once per app: env is read on first use, then cached."""
    cached: object = getattr(state, _AUTH_CACHE_ATTR, _UNSET)
    if cached is _UNSET:
        cached = _EventsAuthSettings().events_token
        setattr(state, _AUTH_CACHE_ATTR, cached)
    return None if cached is None else str(cached)


def require_events_token(
    request: Request,
    authorization: Annotated[str | None, Header()] = None,
) -> None:
    """Fail-closed shared-key guard. Open when ``EDGERECO_EVENTS_TOKEN`` is unset."""
    expected = _expected_token(request.app.state)
    if expected is None:
        return
    presented = _bearer_token(authorization)
    # Compare BYTES: a non-ASCII latin-1 header would make str compare_digest raise
    # TypeError (HTTP 500); encoding both sides keeps the mismatch a clean 401.
    if presented is None or not secrets.compare_digest(presented.encode(), expected.encode()):
        raise HTTPException(status_code=401, detail="invalid or missing events token")


class EventsBody(BaseModel):
    # Reject unknown fields at the wire boundary — a beacon payload carries exactly
    # ``events`` (+ optional ``session_id``); anything else is malformed/hostile.
    model_config = ConfigDict(extra="forbid")

    events: list[InteractionEvent] = Field(max_length=MAX_EVENTS_PER_BATCH)
    # Optional in-body session id for the beacon uplink: navigator.sendBeacon
    # cannot set an X-Session-Id header, so the client folds it into the payload.
    # When present it wins over the header; absent, the header path is unchanged.
    session_id: str | None = Field(default=None, max_length=MAX_SESSION_ID_LEN)


@router.post("/events", response_model=EventsResponse, dependencies=[Depends(require_events_token)])
def post_events(
    body: EventsBody,
    container: Container,
    session_id: Annotated[str, Depends(get_session_id)] = "",
) -> EventsResponse:
    effective_session = body.session_id or session_id
    unknown = [e.product_id for e in body.events if _ingest_event(container, effective_session, e)]
    _warn_unknown(unknown)
    return EventsResponse(received=len(body.events))


def _ingest_event(container: ServiceContainer, session: str, event: InteractionEvent) -> bool:
    """Fold one event into the session + buffer; return True if its product is unknown."""
    product = container.by_id.get(event.product_id)
    if product is not None:
        # The bundle-carried interaction weights drive the fold: republish -> retune.
        weights = container.ranking_config.interaction_weights
        container.sessions.update(session, _updater(product, event.event_type, weights))
    container.events.append(event)
    return product is None


def _warn_unknown(product_ids: list[str]) -> None:
    """Bound the unknown-product noise to one aggregated warning per request."""
    if not product_ids:
        return
    logger.warning(
        "ignored %d event(s) for unknown product_id(s) (e.g. %s)",
        len(product_ids),
        product_ids[0],
    )


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


def _updater(
    product: Product, event_type: EventType, weights: InteractionWeights
) -> Callable[[SessionProfile], SessionProfile]:
    def update(profile: SessionProfile) -> SessionProfile:
        return apply_interaction(profile, product, event_type, weights=weights)

    return update
