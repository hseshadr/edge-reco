"""Product scoring using session profile affinities.

The weights come from the bundle-carried ``RankingConfig`` (``ranking_config.py``),
threaded in by the caller. ``DEFAULT_RANKING_CONFIG.scoring_weights`` reproduces
the original hardcoded constants exactly, so threading config changes no scores.
"""

from __future__ import annotations

from edgereco.catalog.models import Product, SearchResult, SessionProfile
from edgereco.reco.formula import FormulaSignals, explain_score
from edgereco.reco.ranking_config import ScoringWeights


def _tag_match(product: Product, profile: SessionProfile) -> float:
    if not product.tags:
        return 0.0
    return sum(profile.tag_affinity.get(tag, 0.0) for tag in product.tags) / len(product.tags)


def _signals(
    product: Product,
    profile: SessionProfile,
    *,
    similarity: float,
    cooccurrence: float,
    retrieval: float,
) -> FormulaSignals:
    return FormulaSignals(
        retrieval=retrieval,
        popularity=product.popularity_score,
        category_match=profile.category_affinity.get(product.category, 0.0),
        tag_match=_tag_match(product, profile),
        brand_match=profile.brand_affinity.get(product.brand, 0.0) if product.brand else 0.0,
        freshness=product.freshness_score,
        similarity=similarity,
        cooccurrence=cooccurrence,
        repetition_penalty=float(product.id in profile.recently_viewed),
    )


def score_product(
    product: Product,
    profile: SessionProfile,
    weights: ScoringWeights,
    *,
    similarity: float = 0.0,
    cooccurrence: float = 0.0,
    retrieval: float = 0.0,
) -> SearchResult:
    """Score ``product`` under ``weights``.

    ``similarity`` is the per-candidate cosine to a seed (``vector_similarity``);
    ``cooccurrence`` is the per-candidate co-occurrence neighbour score to a seed
    (``co_occurrence``). Both default to 0.0 so every other path reduces to the
    original Phase-1 formula byte-for-byte.
    """
    signals = _signals(
        product,
        profile,
        similarity=similarity,
        cooccurrence=cooccurrence,
        retrieval=retrieval,
    )
    explanation = explain_score(signals, weights)
    components = {row.id: row.contribution for row in explanation.components}
    return SearchResult(
        product=product,
        score=explanation.score,
        score_components=components,
        score_explanation=explanation,
    )
