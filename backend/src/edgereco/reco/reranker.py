"""Rerank search results using session profile, behind an absolute relevance floor.

THE FLOOR EXISTS BECAUSE RANKING ALONE CANNOT SAY "NO"
RRF fuses POSITIONS, not scores: a document ranked first by one retriever scores
1/61 whether it is a perfect match or the least bad of 720 wrong answers. The
rank-normalization below then divides by the best hit in this very result set, so
the top result takes the full relevance weight for every query ever asked. Nothing
downstream could express "no good match", and a full page came back for queries the
catalog cannot answer at all. Demoting junk does not fix that; refusing it does.

Mirrored byte-for-byte in the browser port
(``frontend/packages/edgeproc-browser/src/engine/reranker.ts``); a test in
``tests/unit/reco/test_reranker.py`` reads that file and pins both constants,
because one rule written in two languages will otherwise diverge.
"""

from __future__ import annotations

from typing import Final, NamedTuple

from edgereco.catalog.models import SearchResult, SessionProfile
from edgereco.reco.ranking_config import DEFAULT_RANKING_CONFIG, ScoringWeights
from edgereco.reco.scorer import score_product

_SEARCH_RELEVANCE_WEIGHT: Final[float] = 0.2

#: The absolute semantic floor: the cosine below which a document is, empirically,
#: not an answer. CALIBRATED, NOT CHOSEN — 0.3970 is the highest cosine any document
#: reaches for a query the catalog cannot answer, measured over the golden set's 8
#: ``negative`` queries (576 candidate observations). The floor is that noise ceiling
#: rounded up to the next hundredth.
MIN_SEMANTIC_RELEVANCE: Final[float] = 0.4

#: The absolute lexical floor: any strictly-positive BM25 score is evidence. Same
#: rule, same 8 queries, which produced ZERO positive BM25 scores — the measured
#: lexical noise ceiling is 0. A hit means the query shares a discriminating term
#: with the product's indexed text, which is absolute evidence whatever the
#: embedding thinks. Honest limitation: those queries are nonsense words by
#: construction and so can never produce a BM25 hit, making this side of the floor
#: calibrated on a tautology. Dropping the lexical branch is not the safer option —
#: a semantic-only floor at 0.4 silences three real golden-set queries outright.
MIN_LEXICAL_RELEVANCE: Final[float] = 0.0


class RetrievalEvidence(NamedTuple):
    """What each retriever measured for one candidate, on its own absolute scale.

    ``None`` means "this retriever never scored it", which is not the same as 0.0.
    RRF and the rank-normalization both erase these magnitudes by design, so this is
    the only place they survive to reach the floor.
    """

    semantic: float | None
    """Cosine to the query embedding; None when the vector index did not return it."""

    lexical: float | None
    """BM25 score; None when the keyword index did not return it."""


def meets_relevance_floor(evidence: RetrievalEvidence | None) -> bool:
    """Does this candidate clear the floor on EITHER retriever?

    Hybrid retrieval produces two independent absolute signals and a document needs
    only one of them to be a defensible answer. Missing evidence is a refusal, not a
    pass: a candidate the caller cannot account for is dropped.
    """
    if evidence is None:
        return False
    if evidence.semantic is not None and evidence.semantic >= MIN_SEMANTIC_RELEVANCE:
        return True
    return evidence.lexical is not None and evidence.lexical > MIN_LEXICAL_RELEVANCE


def retrieval_evidence(
    keyword_hits: list[tuple[str, float]],
    vector_hits: list[tuple[str, float]],
) -> dict[str, RetrievalEvidence]:
    """Both retrievers' raw scores keyed by product id — the fusion input, unfused."""
    lexical = dict(keyword_hits)
    semantic = dict(vector_hits)
    return {
        pid: RetrievalEvidence(semantic=semantic.get(pid), lexical=lexical.get(pid))
        for pid in {**lexical, **semantic}
    }


def _retrieval_score(score: float, maximum: float) -> float:
    """Normalize non-negative RRF into the query-relevance component."""
    if maximum <= 0.0:
        return 0.0
    return _SEARCH_RELEVANCE_WEIGHT * max(0.0, score) / maximum


def rerank(
    results: list[SearchResult],
    profile: SessionProfile,
    weights: ScoringWeights = DEFAULT_RANKING_CONFIG.scoring_weights,
) -> list[SearchResult]:
    """Personalize an already-selected recommendation candidate pool."""
    return _descending([score_product(r.product, profile, weights) for r in results])


def rerank_search(
    results: list[SearchResult],
    profile: SessionProfile,
    evidence: dict[str, RetrievalEvidence],
    weights: ScoringWeights = DEFAULT_RANKING_CONFIG.scoring_weights,
) -> list[SearchResult]:
    """Drop what fails the absolute floor, then blend retrieval with session signals.

    ``evidence`` is required, not defaulted: a caller that cannot say what the
    retrievers actually measured gets an empty page, never a silent full one.
    """
    admitted = [r for r in results if meets_relevance_floor(evidence.get(r.product.id))]
    maximum = max((result.score for result in admitted), default=0.0)
    rescored = [
        score_product(
            result.product,
            profile,
            weights,
            retrieval=_retrieval_score(result.score, maximum),
        )
        for result in admitted
    ]
    return _descending(rescored)


def _descending(results: list[SearchResult]) -> list[SearchResult]:
    results.sort(key=lambda result: result.score, reverse=True)
    return results
