"""Step impls for features/hybrid_search.feature."""

from __future__ import annotations

from dataclasses import dataclass

import pytest
from pytest_bdd import given, parsers, scenarios, then, when

from edgereco.catalog.models import Product
from edgereco.embeddings.encoder import ProductEncoder
from edgereco.embeddings.index import VectorIndex
from edgereco.search.hybrid import reciprocal_rank_fusion
from edgereco.search.keyword import KeywordSearcher
from edgereco.search.vector import VectorSearcher

scenarios("hybrid_search.feature")


@dataclass
class StepContext:
    """Mutable state shared across hybrid-search BDD steps."""

    catalog: list[Product] | None = None
    keyword: list[tuple[str, float]] | None = None
    vector: list[tuple[str, float]] | None = None
    hybrid: list[tuple[str, float]] | None = None


@pytest.fixture
def ctx() -> StepContext:
    return StepContext()


@given("the mini catalog of 50 products is loaded")
def _catalog_loaded(ctx: StepContext, bdd_catalog: list[Product]) -> None:
    ctx.catalog = bdd_catalog
    assert len(bdd_catalog) == 50


@given("the BM25 keyword searcher is built")
def _kw_built(bdd_keyword_searcher: KeywordSearcher) -> None:
    assert bdd_keyword_searcher is not None


@given("the FAISS vector index is built")
def _vec_built(bdd_vector_index: VectorIndex) -> None:
    assert bdd_vector_index is not None


@when(parsers.parse('I run hybrid search for "{query}"'))
def _run_hybrid(
    ctx: StepContext,
    query: str,
    bdd_keyword_searcher: KeywordSearcher,
    bdd_vector_searcher: VectorSearcher,
    bdd_encoder: ProductEncoder,
) -> None:
    keyword = bdd_keyword_searcher.search(query, k=5)
    query_emb = bdd_encoder.encode_query(query)
    vector = bdd_vector_searcher.search(query_emb, k=5)
    ctx.keyword = keyword
    ctx.vector = vector
    ctx.hybrid = reciprocal_rank_fusion(keyword, vector, k=60)


@then("the top hybrid results should include products that appear in the keyword top 5")
def _hybrid_includes_keyword(ctx: StepContext) -> None:
    keyword_ids = {pid for pid, _ in ctx.keyword}
    hybrid_ids = {pid for pid, _ in ctx.hybrid[:5]}
    assert hybrid_ids & keyword_ids


@then("the top hybrid results should include products that appear in the vector top 5")
def _hybrid_includes_vector(ctx: StepContext) -> None:
    vector_ids = {pid for pid, _ in ctx.vector}
    hybrid_ids = {pid for pid, _ in ctx.hybrid[:5]}
    assert hybrid_ids & vector_ids


@then(parsers.parse('product "{product_id}" should appear in the top {n:d} hybrid results'))
def _product_in_top_n(ctx: StepContext, product_id: str, n: int) -> None:
    top_ids = [pid for pid, _ in ctx.hybrid[:n]]
    assert product_id in top_ids
