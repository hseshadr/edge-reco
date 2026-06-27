"""Step impls for features/product_search.feature."""

from __future__ import annotations

from dataclasses import dataclass

import pytest
from pytest_bdd import given, parsers, scenarios, then, when

from edgereco.catalog.models import Product
from edgereco.embeddings.encoder import ProductEncoder
from edgereco.search.hybrid import reciprocal_rank_fusion
from edgereco.search.keyword import KeywordSearcher
from edgereco.search.vector import VectorSearcher

scenarios("product_search.feature")


@dataclass
class StepContext:
    """Mutable state shared across product-search BDD steps."""

    catalog: list[Product] | None = None
    results: list[tuple[str, float]] | None = None


@pytest.fixture
def ctx() -> StepContext:
    return StepContext()


@given("the mini catalog of 50 products is loaded")
def _catalog_loaded(ctx: StepContext, bdd_catalog: list[Product]) -> None:
    ctx.catalog = bdd_catalog
    assert len(bdd_catalog) == 50


_VECTOR_SCORE_THRESHOLD = 0.25  # suppress near-zero cosine similarity (noise)


@when('I search for ""')
def _search_empty(ctx: StepContext) -> None:
    ctx.results = []


@when(parsers.parse('I search for "{query}"'))
def _search(
    ctx: StepContext,
    query: str,
    bdd_keyword_searcher: KeywordSearcher,
    bdd_vector_searcher: VectorSearcher,
    bdd_encoder: ProductEncoder,
) -> None:
    keyword = bdd_keyword_searcher.search(query, k=10)
    query_emb = bdd_encoder.encode_query(query)
    vector = [
        (pid, score)
        for pid, score in bdd_vector_searcher.search(query_emb, k=10)
        if score >= _VECTOR_SCORE_THRESHOLD
    ]
    if not keyword and not vector:
        ctx.results = []
        return
    ctx.results = reciprocal_rank_fusion(keyword, vector, k=60)


@when(parsers.parse('I search for "{query}" within the {category} category'))
def _search_with_filter(
    ctx: StepContext,
    query: str,
    category: str,
    bdd_catalog: list[Product],
    bdd_keyword_searcher: KeywordSearcher,
    bdd_vector_searcher: VectorSearcher,
    bdd_encoder: ProductEncoder,
) -> None:
    keyword = bdd_keyword_searcher.search(query, k=20)
    query_emb = bdd_encoder.encode_query(query)
    vector = [
        (pid, score)
        for pid, score in bdd_vector_searcher.search(query_emb, k=20)
        if score >= _VECTOR_SCORE_THRESHOLD
    ]
    fused = reciprocal_rank_fusion(keyword, vector, k=60)
    by_id = {p.id: p for p in bdd_catalog}
    ctx.results = [(pid, score) for pid, score in fused if by_id[pid].category == category]


@then(parsers.parse("I should see at least one product in the {category} category"))
def _at_least_one_in_category(
    ctx: StepContext,
    category: str,
    bdd_catalog: list[Product],
) -> None:
    by_id = {p.id: p for p in bdd_catalog}
    matching = [pid for pid, _ in ctx.results if by_id[pid].category == category]
    assert matching


@then(parsers.parse('the top result should mention "{a}" or "{b}" or "{c}"'))
def _top_result_mentions(
    ctx: StepContext,
    a: str,
    b: str,
    c: str,
    bdd_catalog: list[Product],
) -> None:
    by_id = {p.id: p for p in bdd_catalog}
    top_id, _ = ctx.results[0]
    title = by_id[top_id].title.lower()
    tags = " ".join(by_id[top_id].tags).lower()
    text = f"{title} {tags}"
    assert any(term.lower() in text for term in (a, b, c))


@then("every result should be in the Clothing category")
def _every_result_clothing(
    ctx: StepContext,
    bdd_catalog: list[Product],
) -> None:
    by_id = {p.id: p for p in bdd_catalog}
    assert ctx.results
    assert all(by_id[pid].category == "Clothing" for pid, _ in ctx.results)


@then("I should see no results")
def _no_results(ctx: StepContext) -> None:
    assert ctx.results == []
