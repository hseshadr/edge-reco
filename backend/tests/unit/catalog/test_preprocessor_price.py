"""amazon_row_to_product treats None as missing price; preserves 0.0."""

from __future__ import annotations

from typing import Any

from edgereco.catalog.preprocessor import amazon_row_to_product


def _row(price: object) -> dict[str, Any]:
    return {
        "asin": "X1",
        "title": "t",
        "category_id": "Books",
        "stars": 4.0,
        "reviews": 10,
        "boughtInLastMonth": 1,
        "price": price,
    }


def _kwargs() -> dict[str, float]:
    return {"pop_min": 0.0, "pop_max": 10.0, "fresh_min": 0.0, "fresh_max": 10.0}


def test_zero_price_preserved() -> None:
    p = amazon_row_to_product(_row(0.0), **_kwargs())
    assert p.price == 0.0


def test_missing_price_is_none() -> None:
    p = amazon_row_to_product(_row(None), **_kwargs())
    assert p.price is None
