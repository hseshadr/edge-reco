"""Normalize Amazon product data to EdgeReco Product model."""

from __future__ import annotations

import ast
import math
import re
from collections.abc import Mapping

from .models import Product

BREADCRUMB_SEP = "\u203a"  # SINGLE RIGHT-POINTING ANGLE QUOTATION MARK (dataset separator)
_FLOAT_RE = re.compile(r"\d+(?:\.\d+)?")
_INT_RE = re.compile(r"\d+")


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
    row: Mapping[str, str | float | int],
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


# ---------------------------------------------------------------------------
# scraped-Amazon CSV adapter (different schema from the Kaggle path above)
# ---------------------------------------------------------------------------


def _split_breadcrumbs(breadcrumbs: str) -> tuple[str, list[str]]:
    """Split 'A > B > C' (U+203A separators) into (category, subcategories)."""
    parts = [p.strip() for p in str(breadcrumbs).split(BREADCRUMB_SEP) if p.strip()]
    if not parts:
        return ("Uncategorized", [])
    return (parts[0], parts[1:])


def _parse_price(raw: object) -> float | None:
    """Parse a price string to a 2dp float; blank/malformed -> None."""
    text = str(raw or "").strip()
    if not text:
        return None
    match = _FLOAT_RE.search(text.replace(",", ""))
    return round(float(match.group()), 2) if match else None


def _parse_int(raw: object) -> int:
    """Extract the leading integer from a string (e.g. '50+ bought'); else 0."""
    match = _INT_RE.search(str(raw or "").replace(",", ""))
    return int(match.group()) if match else 0


def _parse_rating(stars_raw: object, count_raw: object) -> tuple[float, int]:
    """Extract leading float stars and integer rating count; defaults 0."""
    stars_m = _FLOAT_RE.search(str(stars_raw or ""))
    stars = float(stars_m.group()) if stars_m else 0.0
    return (stars, _parse_int(count_raw))


def _safe_literal(text: str) -> object:
    """Parse a Python literal; return None on malformed input (never executes code)."""
    try:
        return ast.literal_eval(text)
    except (ValueError, SyntaxError):
        return None


def _first_image(raw: object) -> str:
    """Parse a stringified image list and return the first URL; else ''."""
    parsed = _safe_literal(str(raw or "").strip() or "''")
    if isinstance(parsed, (list, tuple)) and parsed:
        return str(parsed[0]).strip()
    return ""


def compute_scraped_popularity_raw(stars: float, count: int) -> float:
    """Raw popularity for the scraped schema: stars x log1p(rating count)."""
    return stars * math.log1p(count)


def _description(row: Mapping[str, str]) -> str:
    """Prefer about_item; fall back to product_description."""
    about = str(row.get("about_item") or "").strip()
    return about or str(row.get("product_description") or "").strip()


def scraped_row_to_product(
    row: Mapping[str, str],
    *,
    pop_min: float,
    pop_max: float,
    fresh_min: float,
    fresh_max: float,
) -> Product:
    """Convert a scraped-Amazon CSV row to an EdgeReco Product (tolerant)."""
    category, subcategories = _split_breadcrumbs(str(row.get("breadcrumbs", "")))
    stars, count = _parse_rating(row.get("rating_stars"), row.get("rating_count"))
    pop_raw = compute_scraped_popularity_raw(stars, count)
    fresh_raw = float(_parse_int(row.get("recent_purchases")))

    return Product(
        id=str(row["asin"]),
        title=str(row.get("title", "")),
        description=_description(row),
        category=category,
        subcategories=subcategories,
        tags=[s.lower().replace(" ", "-") for s in subcategories],
        brand=str(row.get("brand_name") or row.get("manufacturer") or ""),
        price=_parse_price(row.get("price_value")),
        popularity_score=normalize_score(pop_raw, min_val=pop_min, max_val=pop_max),
        freshness_score=normalize_score(fresh_raw, min_val=fresh_min, max_val=fresh_max),
        image_url=_first_image(row.get("all_images")),
        url=str(row.get("product_url", "")),
    )
