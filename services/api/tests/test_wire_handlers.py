from pathlib import Path

from app.domain.catalog import load_catalog
from app.generated import models as wire
from app.wire.handlers import (
    build_candidate_response,
    build_catalog_response,
    build_healthz_response,
    ingest_event_batch,
    wire_to_domain_context,
)

FIXTURE = Path(__file__).parent / "fixtures" / "mini_catalog.json"


def test_healthz_response() -> None:
    body = build_healthz_response()
    assert body["status"] == "ok"


def test_build_catalog_response_contains_all_items() -> None:
    catalog = load_catalog(FIXTURE)
    resp = build_catalog_response(catalog)
    assert len(resp.items) == len(catalog)
    assert resp.items[0].id == catalog[0].id


def test_wire_request_translates_to_domain_context() -> None:
    req = wire.CandidateRequest(contextType="homepage", categoryHint="running", limit=5)
    ctx = wire_to_domain_context(req)
    assert ctx.context_type == "homepage"
    assert ctx.category_hint == "running"
    assert ctx.limit == 5


def test_build_candidate_response_passes_through_items() -> None:
    catalog = load_catalog(FIXTURE)
    running = [i for i in catalog if i.category == "running"]
    resp = build_candidate_response(running)
    assert [i.id for i in resp.items] == [i.id for i in running]


def test_ingest_event_batch_logs_and_counts() -> None:
    seen: list[str] = []
    batch = wire.EventBatch(
        events=[
            wire.Event(
                eventId="e1",
                eventType="click",
                itemId="a",
                timestamp="2026-04-11T00:00:00Z",
                contextType="homepage",
            )
        ]
    )
    count = ingest_event_batch(batch, sink=lambda evt: seen.append(evt.event_id))
    assert count == 1
    assert seen == ["e1"]
