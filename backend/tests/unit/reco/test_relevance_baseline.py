"""The relevance ratchet: EdgeReco's ranking quality may improve, never regress.

WHAT THIS GATES
Every floor below is TODAY'S MEASURED NUMBER, not a target. The gate passes on the
unmodified ranker by construction — a threshold chosen after a ranking fix measures
nothing, because you can always pick one the new code clears. Pinned at the baseline,
the gate answers exactly one question: did this change make relevance worse?

WHERE THE NUMBERS CAME FROM
``assay.ranking`` (ir_measures/trec_eval) over the committed
``relevance_export.json``, 2026-08-03, at the export's own depth k=24 and at the
conventional first-page depth k=10. Python reproduces the TypeScript suite's reported
P@10 to six decimals in both segments (natural 0.233333, taxonomy-word 0.775000),
which is the cross-language agreement that lets one committed metric stand for both.

WHY FLOORS ARE ROUNDED DOWN TO 4dp
0.422503 is asserted as 0.4225. trec_eval is deterministic and the export is a static
committed artifact, so the metric is exactly reproducible; the ~2.5e-5 of slack exists
only so a BLAS thread count cannot turn float noise into a red run. It is far tighter
than any regression worth catching — a single relevant document falling out of the
top 10 moves natural nDCG@10 by ~0.02, three orders of magnitude more.

RAISING A FLOOR IS THE POINT
When a ranking fix lands, its PR re-measures and raises these numbers. That is the
ratchet working. Lowering one is a regression being waved through, and needs to be
argued for in the PR that does it — never a quiet edit.
"""

from __future__ import annotations

from pathlib import Path
from typing import Final, NamedTuple

import pytest

from edgereco.reco.relevance_baseline import (
    RelevanceExport,
    Segment,
    full_depth_negatives,
    load_export,
    segment_report,
)


class Floor(NamedTuple):
    """One gated metric: which segment, which metric, at which depth, and the floor."""

    segment: Segment
    metric: str
    k: int
    minimum: float


#: The baseline, measured 2026-08-03 on the unmodified ranker.
#:
#: nDCG@10 and recall@k are the two metrics named as this repo's restoration
#: condition; precision@k rides along because it is the number the golden set's own
#: commit message reported, so a reader can tie the two together.
#:
#: The natural/taxonomy-word gap IS the finding — natural nDCG@10 0.4225 against
#: taxonomy-word 0.7610 is the retrieval leak, quantified. Both are gated separately
#: and neither is ever averaged with the other.
BASELINE: Final[tuple[Floor, ...]] = (
    # natural (n=30): wording held out of both retrieval representations.
    Floor("natural", "mean_ndcg_at_k", 10, 0.4225),
    Floor("natural", "mean_recall_at_k", 10, 0.5286),
    Floor("natural", "mean_precision_at_k", 10, 0.2333),
    Floor("natural", "mean_ndcg_at_k", 24, 0.5416),
    Floor("natural", "mean_recall_at_k", 24, 0.8333),
    # taxonomy-word (n=12): the leaky control group, gated so the leak cannot widen.
    Floor("taxonomy-word", "mean_ndcg_at_k", 10, 0.7610),
    Floor("taxonomy-word", "mean_recall_at_k", 10, 0.1277),
    Floor("taxonomy-word", "mean_precision_at_k", 10, 0.7750),
    Floor("taxonomy-word", "mean_ndcg_at_k", 24, 0.7566),
    Floor("taxonomy-word", "mean_recall_at_k", 24, 0.3006),
)

#: Today every one of the 8 negative queries comes back holding all 24 results.
NEGATIVES_AT_FULL_DEPTH: Final[int] = 8


def measure(export: RelevanceExport, floor: Floor) -> float:
    """The value ``floor`` gates. The ratchet and the teeth test share this predicate.

    They must: a guard proven against a different code path than the one that runs in
    CI proves nothing about the gate. Both call this.
    """
    report = segment_report(export, floor.segment, k=floor.k)
    value = getattr(report, floor.metric)
    assert isinstance(value, float)
    return value


@pytest.fixture(scope="module")
def export() -> RelevanceExport:
    """The committed export, parsed once."""
    return load_export()


def test_export_is_the_committed_amazon_demo_baseline(export: RelevanceExport) -> None:
    """Pin what is being measured, so a swapped catalog cannot pass as a green gate."""
    assert export.catalog_id == "amazon-demo"
    assert export.label_method == "breadcrumb-node-membership"
    assert export.k == 24
    assert len(export.queries) == 50


def test_every_segment_is_populated(export: RelevanceExport) -> None:
    """A segment silently emptied would make its floors vacuously true."""
    assert len(export.in_segment("natural")) == 30
    assert len(export.in_segment("taxonomy-word")) == 12
    assert len(export.in_segment("negative")) == 8


@pytest.mark.parametrize(
    "floor",
    BASELINE,
    ids=lambda f: f"{f.segment}-{f.metric}@{f.k}",
)
def test_relevance_has_not_regressed(export: RelevanceExport, floor: Floor) -> None:
    """THE RATCHET. Each metric is at or above the 2026-08-03 measurement."""
    value = measure(export, floor)
    assert value >= floor.minimum, (
        f"{floor.metric}@{floor.k} for {floor.segment!r} fell to {value:.6f}, "
        f"below the {floor.minimum} baseline — relevance regressed."
    )


@pytest.mark.parametrize(
    "floor",
    [f for f in BASELINE if f.metric == "mean_ndcg_at_k"],
    ids=lambda f: f"{f.segment}@{f.k}",
)
def test_the_ratchet_refuses_a_degraded_ranking(export: RelevanceExport, floor: Floor) -> None:
    """PROOF THE GATE CAN FAIL — the permanent half of the watched red run.

    Reverse every ranked list and the relevant documents, which sit near the top,
    land at the bottom. Retrieval is untouched (the same documents come back, in the
    same count); only the ORDER is destroyed, which is exactly the property nDCG
    measures and a position-blind metric would miss entirely.

    A green ratchet is evidence only if this test would be red without it.
    """
    degraded = export.model_copy(
        update={
            "queries": tuple(
                query.model_copy(update={"ranked_ids": tuple(reversed(query.ranked_ids))})
                for query in export.queries
            )
        }
    )
    value = measure(degraded, floor)
    assert value < floor.minimum, (
        f"a fully reversed ranking still scored {value:.6f} on "
        f"{floor.metric}@{floor.k} for {floor.segment!r} — this gate has no teeth."
    )


def test_negative_queries_return_the_full_page_KNOWN_DEFECT(export: RelevanceExport) -> None:  # noqa: N802
    """A WITNESS TO A DEFECT, deliberately asserted as it stands today.

    Nothing in the catalog answers a negative query, so the honest response is few
    results or none. All 8 come back holding the full 24. The cause is known and out
    of scope here: the reranker rank-normalises each retrieval score against the best
    hit in its OWN result set (``reranker.ts:107,117``), so there is no absolute
    floor and no response can ever express "no good match".

    THE FIX MUST INVERT THIS ASSERTION, NOT DELETE IT. When a score floor lands, this
    count drops and this test goes red — that red is the fix working, and the PR that
    causes it says so and rewrites the expectation downward. Deleting it would erase
    the only record that the defect was ever measured.
    """
    assert full_depth_negatives(export) == NEGATIVES_AT_FULL_DEPTH


def test_scoring_the_negative_segment_is_refused(export: RelevanceExport) -> None:
    """Refusing beats scoring 0.0: a 0.0 blames the ranker for missing judgments."""
    with pytest.raises(ValueError, match="no relevant set"):
        segment_report(export, "negative", k=10)


def test_an_empty_segment_is_refused(export: RelevanceExport) -> None:
    """A floor over zero queries would be vacuously true — refuse instead."""
    empty = export.model_copy(update={"queries": export.in_segment("taxonomy-word")})
    with pytest.raises(ValueError, match="no 'natural' queries"):
        segment_report(empty, "natural", k=10)


def test_export_path_is_read_from_disk(tmp_path: Path, export: RelevanceExport) -> None:
    """``load_export`` reads the path it is given, so the default is not the only way."""
    copy = tmp_path / "relevance_export.json"
    copy.write_text(export.model_dump_json(), encoding="utf-8")
    assert load_export(copy).queries == export.queries
