"""Normalize Amazon product data to EdgeReco Product model."""

from __future__ import annotations

import math
from typing import Any

from .models import Product


def normalize_score(value: float, *, min_val: float, max_val: float) -> float:
    """Normalize a value to [0, 1] given min and max bounds."""
    if max_val <= min_val:
        return 0.0
    return max(0.0, min(1.0, (value - min_val) / (max_val - min_val)))


def compute_popularity_raw(stars: float, reviews: int) -> float:
    """Compute raw popularity score from stars and review count."""
    return stars * math.log(reviews + 1)


def parse_category_hierarchy(category_id: str) -> tuple[str, list[str]]:
    """Parse 'Electronics > Audio > Headphones' into (category, subcategories)."""
    parts = [p.strip() for p in category_id.split(">") if p.strip()]
    if not parts:
        return ("Unknown", [])
    return (parts[0], parts[1:])


def amazon_row_to_product(
    row: dict[str, Any],
    *,
    pop_min: float,
    pop_max: float,
    fresh_min: float,
    fresh_max: float,
) -> Product:
    """Convert an Amazon CSV row to an EdgeReco Product."""
    category, subcategories = parse_category_hierarchy(str(row.get("category_id", "")))
    tags = [s.lower().replace(" ", "-") for s in subcategories]

    pop_raw = compute_popularity_raw(
        float(row.get("stars", 0)),
        int(row.get("reviews", 0)),
    )

    return Product(
        id=str(row["asin"]),
        title=str(row.get("title", "")),
        category=category,
        subcategories=subcategories,
        tags=tags,
        brand="",
        price=(float(row["price"]) if "price" in row and row["price"] is not None else None),
        popularity_score=normalize_score(pop_raw, min_val=pop_min, max_val=pop_max),
        freshness_score=normalize_score(
            float(row.get("boughtInLastMonth", 0)),
            min_val=fresh_min,
            max_val=fresh_max,
        ),
        image_url=str(row.get("imgUrl", "")),
        url=str(row.get("productURL", "")),
    )
