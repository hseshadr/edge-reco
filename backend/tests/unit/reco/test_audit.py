"""Unit tests for the read-only retrain audit report builder (``reco.audit``).

``build_audit_report`` is a pure function over fixed inputs: it summarises the
collected events (counts by type / session), the top popularity movers between the
current and freshly-retrained catalogs, and how many co-occurrence edges changed.
Never in the inference path; deterministic so the table is reproducible.
"""

from __future__ import annotations

from edgereco.catalog.models import Product
from edgereco.reco.audit import AuditReport, build_audit_report
from edgereco.reco.cooccurrence import (
    CooccurrenceMatrix,
    Neighbor,
    SessionEvent,
    SessionLog,
)

_LOGS = [
    SessionLog(
        session_id="s1",
        events=[
            SessionEvent(product_id="P1", event_type="cart"),
            SessionEvent(product_id="P2", event_type="click"),
        ],
    ),
    SessionLog(
        session_id="s2",
        events=[SessionEvent(product_id="P1", event_type="click")],
    ),
]


def _report() -> AuditReport:
    before = [
        Product(id="P1", title="A", category="X", popularity_score=0.2),
        Product(id="P2", title="B", category="X", popularity_score=0.5),
    ]
    after = [
        Product(id="P1", title="A", category="X", popularity_score=0.7),
        Product(id="P2", title="B", category="X", popularity_score=0.5),
    ]
    before_cooc = CooccurrenceMatrix()
    after_cooc = CooccurrenceMatrix(neighbors={"P1": [Neighbor(id="P2", score=0.9)]})
    return build_audit_report(
        logs=_LOGS,
        before=before,
        after=after,
        before_cooccurrence=before_cooc,
        after_cooccurrence=after_cooc,
        current_version="v1",
        new_version="v2",
        schema_version=3,
    )


def test_total_event_count() -> None:
    report = _report()
    assert report.total_events == 3


def test_event_counts_by_type() -> None:
    report = _report()
    assert report.events_by_type == {"cart": 1, "click": 2}


def test_session_count() -> None:
    report = _report()
    assert report.session_count == 2


def test_top_popularity_movers_sorted_by_absolute_delta() -> None:
    report = _report()
    assert [m.product_id for m in report.popularity_movers] == ["P1"]
    assert report.popularity_movers[0].before == 0.2
    assert report.popularity_movers[0].after == 0.7


def test_changed_cooccurrence_edge_count() -> None:
    report = _report()
    # P1 gained one neighbour (P2) it did not have before.
    assert report.changed_cooccurrence_edges == 1


def test_version_and_schema_carried() -> None:
    report = _report()
    assert report.current_version == "v1"
    assert report.new_version == "v2"
    assert report.schema_version == 3


def test_movers_capped_at_top_n() -> None:
    before = [Product(id=f"P{i}", title="t", category="X", popularity_score=0.0) for i in range(30)]
    after = [
        Product(id=f"P{i}", title="t", category="X", popularity_score=i / 100) for i in range(30)
    ]
    report = build_audit_report(
        logs=[],
        before=before,
        after=after,
        before_cooccurrence=CooccurrenceMatrix(),
        after_cooccurrence=CooccurrenceMatrix(),
        current_version="v1",
        new_version="v2",
        schema_version=3,
        top_movers=10,
    )
    assert len(report.popularity_movers) == 10
    # Highest absolute delta first.
    assert report.popularity_movers[0].product_id == "P29"


def test_audit_inputs_assembles_before_after() -> None:
    """``audit_inputs`` previews popularity + co-occurrence from the log alone."""
    from edgereco.reco.audit import audit_inputs

    before = [
        Product(id="P1", title="A", category="X", popularity_score=0.2),
        Product(id="P2", title="B", category="X", popularity_score=0.5),
    ]
    # _LOGS engages P1 (cart + click) most, so P1 is boosted; P2 (one click) less.
    inputs = audit_inputs(products=before, logs=_LOGS, alpha=0.5)
    after_by_id = {p.id: p for p in inputs.after}
    assert after_by_id["P1"].popularity_score > 0.2  # boosted (highest engagement)
    assert {n.id for n in inputs.after_cooccurrence.neighbors["P1"]} == {"P2"}


def test_render_table_is_human_readable() -> None:
    from edgereco.reco.audit import render_audit_table

    text = render_audit_table(_report())
    assert "v1" in text
    assert "v2" in text
    assert "P1" in text
    assert "3" in text  # total events
