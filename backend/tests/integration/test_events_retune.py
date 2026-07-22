"""Integration: republishing retuned ``interaction_weights`` retunes ranking.

The signed bundle carries ``RankingConfig.interaction_weights`` as a governable
knob: a maintainer retunes ranking by republishing data — no code change, no
redeploy. These tests guard the whole chain: staged config → signed bundle →
``from_synced`` container → ``/events`` affinity fold → ``/recommend`` output.
"""

from __future__ import annotations

import uuid

import pytest
from fastapi.testclient import TestClient

from edgereco.api.app import create_app
from edgereco.api.deps import ServiceContainer
from edgereco.reco.ranking_config import DEFAULT_RANKING_CONFIG, GradedSignal
from tests.integration.conftest import build_synced_container

# 5x the default click category bump (0.10) — far outside float noise, still <= 1.0.
RETUNED_CLICK_CATEGORY = 0.5


@pytest.fixture(scope="module")
def retuned_container(tmp_path_factory: pytest.TempPathFactory) -> ServiceContainer:
    """A container synced from a bundle republished with a retuned click bump."""
    retuned_weights = DEFAULT_RANKING_CONFIG.interaction_weights.model_copy(
        update={"click": GradedSignal(category=RETUNED_CLICK_CATEGORY, tag=0.05, brand=0.08)}
    )
    retuned = DEFAULT_RANKING_CONFIG.model_copy(update={"interaction_weights": retuned_weights})
    return build_synced_container(tmp_path_factory, ranking_config=retuned)


@pytest.fixture(scope="module")
def retuned_client(retuned_container: ServiceContainer) -> TestClient:
    return TestClient(create_app(retuned_container))


def _click_events_payload(product_id: str) -> dict[str, list[dict[str, str]]]:
    return {
        "events": [
            {
                "event_type": "click",
                "product_id": product_id,
                "timestamp": "2026-04-26T00:00:00Z",
            }
        ]
    }


def test_republished_interaction_weights_drive_the_events_fold(
    retuned_client: TestClient, retuned_container: ServiceContainer
) -> None:
    # Given a session against a bundle republished with a 5x click category bump
    session_id = str(uuid.uuid4())
    # When one click event is ingested
    response = retuned_client.post(
        "/events", json=_click_events_payload("B001"), headers={"X-Session-Id": session_id}
    )
    assert response.status_code == 200
    # Then the session profile carries the RETUNED bump, not a hardcoded constant
    profile = retuned_container.sessions.get(session_id)
    assert profile.category_affinity["Electronics"] == RETUNED_CLICK_CATEGORY


def test_republished_interaction_weights_change_recommend_output(
    client: TestClient, retuned_client: TestClient
) -> None:
    # Given identical click journeys against the default and the retuned bundle
    scores: list[list[float]] = []
    for tier in (client, retuned_client):
        session_id = str(uuid.uuid4())
        tier.post(
            "/events", json=_click_events_payload("B001"), headers={"X-Session-Id": session_id}
        )
        # When each tier recommends for its session
        body = tier.get("/recommend?limit=10", headers={"X-Session-Id": session_id}).json()
        scores.append([r["score"] for r in body["results"]])
    # Then the republished weights change the ranking output (republish -> retune)
    assert scores[0] != scores[1]
