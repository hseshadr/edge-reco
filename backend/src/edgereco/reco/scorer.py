"""Product scoring using session profile affinities.

The weights come from the bundle-carried ``RankingConfig`` (``ranking_config.py``),
threaded in by the caller. ``DEFAULT_RANKING_CONFIG.scoring_weights`` reproduces
the original hardcoded constants exactly, so threading config changes no scores.
"""

from __future__ import annotations

from edgereco.catalog.models import Product, SearchResult, SessionProfile
from edgereco.reco.ranking_config import ScoringWeights


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
    cat_match = profile.category_affinity.get(product.category, 0.0)

    tag_match = 0.0
    if product.tags:
        tag_match = sum(profile.tag_affinity.get(t, 0.0) for t in product.tags) / len(product.tags)

    brand_match = profile.brand_affinity.get(product.brand, 0.0) if product.brand else 0.0
    penalty = weights.repetition_penalty if product.id in profile.recently_viewed else 0.0

    components = {
        "retrieval": retrieval,
        "popularity": weights.popularity * product.popularity_score,
        "category_match": weights.category * cat_match,
        "tag_match": weights.tag * tag_match,
        "brand_match": weights.brand * brand_match,
        "freshness": weights.freshness * product.freshness_score,
        "similarity": weights.similarity * similarity,
        "cooccurrence": weights.cooccurrence * cooccurrence,
        # Stored as the POSITIVE penalty magnitude so the breakdown mirrors the TS
        # browser reranker byte-for-byte (reranker.ts:69 / reranker.test.ts: +0.25).
        # The subtraction lives only in ``score`` below.
        "repetition_penalty": penalty,
    }
    score = (
        components["retrieval"]
        + components["popularity"]
        + components["category_match"]
        + components["tag_match"]
        + components["brand_match"]
        + components["freshness"]
        + components["similarity"]
        + components["cooccurrence"]
        - components["repetition_penalty"]
    )
    return SearchResult(product=product, score=score, score_components=components)
