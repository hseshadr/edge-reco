from pathlib import Path

import pytest

from app.domain.catalog import filter_candidates, load_catalog
from app.domain.types import DomainCandidateContext

FIXTURE = Path(__file__).parent / "fixtures" / "mini_catalog.json"


def test_load_catalog_returns_domain_items() -> None:
    catalog = load_catalog(FIXTURE)
    assert len(catalog) == 3
    by_id = {item.id: item for item in catalog}
    assert by_id["a"].category == "running"
    assert by_id["a"].tags == ("lightweight",)
    assert by_id["a"].popularity_score == pytest.approx(0.7)


def test_filter_candidates_sorts_by_popularity() -> None:
    catalog = load_catalog(FIXTURE)
    ctx = DomainCandidateContext(context_type="homepage", category_hint=None, limit=10)
    result = filter_candidates(catalog, ctx)
    assert [i.id for i in result] == ["b", "a", "c"]


def test_filter_candidates_respects_category_hint() -> None:
    catalog = load_catalog(FIXTURE)
    ctx = DomainCandidateContext(context_type="homepage", category_hint="running", limit=10)
    result = filter_candidates(catalog, ctx)
    assert [i.id for i in result] == ["a", "c"]


def test_filter_candidates_respects_limit() -> None:
    catalog = load_catalog(FIXTURE)
    ctx = DomainCandidateContext(context_type="homepage", category_hint=None, limit=1)
    result = filter_candidates(catalog, ctx)
    assert [i.id for i in result] == ["b"]


def test_filter_candidates_returns_empty_when_hint_matches_nothing() -> None:
    catalog = load_catalog(FIXTURE)
    ctx = DomainCandidateContext(context_type="homepage", category_hint="sleep", limit=10)
    result = filter_candidates(catalog, ctx)
    assert result == []
