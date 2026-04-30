from pathlib import Path

from edgereco.catalog.loader import load_jsonl

FIXTURES = Path(__file__).parent.parent.parent / "fixtures"


def test_load_jsonl_returns_products() -> None:
    products = load_jsonl(FIXTURES / "mini_catalog.jsonl")
    assert len(products) == 5
    assert products[0].id == "B001"
    assert products[0].category == "Electronics"


def test_load_jsonl_preserves_all_fields() -> None:
    products = load_jsonl(FIXTURES / "mini_catalog.jsonl")
    headphones = products[0]
    assert headphones.brand == "SoundMax"
    assert headphones.price == 79.99
    assert "wireless" in headphones.tags
    assert headphones.popularity_score == 0.85


def test_load_jsonl_empty_file(tmp_path: Path) -> None:
    empty = tmp_path / "empty.jsonl"
    empty.write_text("")
    products = load_jsonl(empty)
    assert products == []
