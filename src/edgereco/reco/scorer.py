"""Product scoring using session profile affinities."""

from __future__ import annotations

from edgereco.catalog.models import Product, SearchResult, SessionProfile

SCORING_WEIGHTS = {
    "popularity": 0.40,
    "category": 0.20,
    "tag": 0.15,
    "brand": 0.10,
    "freshness": 0.10,
    "repetition_penalty": 0.25,
}


def score_product(product: Product, profile: SessionProfile) -> SearchResult:
    cat_match = profile.category_affinity.get(product.category, 0.0)

    tag_match = 0.0
    if product.tags:
        tag_match = sum(profile.tag_affinity.get(t, 0.0) for t in product.tags) / len(product.tags)

    brand_match = profile.brand_affinity.get(product.brand, 0.0) if product.brand else 0.0

    is_recent = product.id in profile.recently_viewed
    penalty = SCORING_WEIGHTS["repetition_penalty"] if is_recent else 0.0

    pop = SCORING_WEIGHTS["popularity"] * product.popularity_score
    cat = SCORING_WEIGHTS["category"] * cat_match
    tag = SCORING_WEIGHTS["tag"] * tag_match
    brand = SCORING_WEIGHTS["brand"] * brand_match
    fresh = SCORING_WEIGHTS["freshness"] * product.freshness_score

    return SearchResult(
        product=product,
        score=pop + cat + tag + brand + fresh - penalty,
        score_components={
            "popularity": pop,
            "category_match": cat,
            "tag_match": tag,
            "brand_match": brand,
            "freshness": fresh,
            "repetition_penalty": penalty,
        },
    )
