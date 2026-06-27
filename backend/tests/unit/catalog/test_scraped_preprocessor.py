"""Adapter for the scraped-Amazon CSV schema -> Product + build-catalog CLI."""

from __future__ import annotations

from pathlib import Path

from typer.testing import CliRunner

from edgereco.catalog.loader import load_jsonl
from edgereco.catalog.models import Product
from edgereco.catalog.preprocessor import (
    _first_image,
    _parse_price,
    _parse_rating,
    _split_breadcrumbs,
    scraped_row_to_product,
)
from edgereco.cli import app

# ---------------------------------------------------------------------------
# fixtures: synthetic rows mirroring the real dirty schema
# ---------------------------------------------------------------------------

_CLEAN: dict[str, str] = {
    "asin": "B0CLEAN",
    "title": "Wireless Headphones",
    "about_item": "Great sound. Long battery.",
    "product_description": "A pair of headphones.",
    "price_value": "29.999",
    "list_price": "49.99",
    "breadcrumbs": "Electronics \u203a Audio \u203a Headphones",
    "brand_name": "Acme",
    "manufacturer": "Acme Corp",
    "rating_stars": "4.6 out of 5 stars",
    "rating_count": "1,654 ratings",
    "recent_purchases": "50+ bought",
    "all_images": "['https://img/a.jpg', 'https://img/b.jpg']",
    "product_url": "https://amazon.com/dp/B0CLEAN",
}

_FALLBACK_DESC: dict[str, str] = {
    **_CLEAN,
    "asin": "B0FALL",
    "about_item": "",
    "product_description": "Fallback description used.",
}

_BLANK_CRUMB: dict[str, str] = {
    **_CLEAN,
    "asin": "B0BLANK",
    "breadcrumbs": "",
}

_MALFORMED: dict[str, str] = {
    **_CLEAN,
    "asin": "B0BAD",
    "price_value": "",
    "rating_stars": "no rating",
    "rating_count": "",
    "recent_purchases": "",
    "all_images": "not-a-list[",
}

_NORM = {"pop_min": 0.0, "pop_max": 30.0, "fresh_min": 0.0, "fresh_max": 50.0}


def _product(row: dict[str, str]) -> Product:
    return scraped_row_to_product(row, **_NORM)


# ---------------------------------------------------------------------------
# 1. field mapping on the clean row
# ---------------------------------------------------------------------------


def test_clean_row_field_mapping() -> None:
    p = _product(_CLEAN)
    assert p.id == "B0CLEAN"
    assert p.title == "Wireless Headphones"
    assert p.description == "Great sound. Long battery."
    assert p.category == "Electronics"
    assert p.subcategories == ["Audio", "Headphones"]
    assert p.tags == ["audio", "headphones"]
    assert p.brand == "Acme"
    assert p.price == 30.0
    assert p.image_url == "https://img/a.jpg"
    assert p.url == "https://amazon.com/dp/B0CLEAN"


# ---------------------------------------------------------------------------
# 2. about_item preferred; product_description fallback
# ---------------------------------------------------------------------------


def test_description_fallback_to_product_description() -> None:
    assert _product(_FALLBACK_DESC).description == "Fallback description used."


def test_description_prefers_about_item() -> None:
    assert _product(_CLEAN).description == "Great sound. Long battery."


# ---------------------------------------------------------------------------
# 3. breadcrumbs split on U+203A
# ---------------------------------------------------------------------------


def test_split_breadcrumbs() -> None:
    cat, subs = _split_breadcrumbs("Electronics \u203a Audio \u203a Headphones")
    assert cat == "Electronics"
    assert subs == ["Audio", "Headphones"]


# ---------------------------------------------------------------------------
# 4. price rounds to 2dp; blank -> None
# ---------------------------------------------------------------------------


def test_price_rounds_two_dp() -> None:
    assert _parse_price("29.999") == 30.0


def test_blank_price_is_none() -> None:
    assert _parse_price("") is None
    assert _product(_MALFORMED).price is None


# ---------------------------------------------------------------------------
# 5. all_images list-string -> first url; malformed -> ""
# ---------------------------------------------------------------------------


def test_first_image_from_list_string() -> None:
    assert _first_image("['https://img/a.jpg', 'https://img/b.jpg']") == "https://img/a.jpg"


def test_first_image_malformed_returns_empty() -> None:
    assert _first_image("not-a-list[") == ""
    assert _product(_MALFORMED).image_url == ""


# ---------------------------------------------------------------------------
# 6. popularity/freshness normalized into [0,1]
# ---------------------------------------------------------------------------


def test_parse_rating_extracts_stars_and_count() -> None:
    stars, count = _parse_rating("4.6 out of 5 stars", "1,654 ratings")
    assert stars == 4.6
    assert count == 1654


def test_scores_normalized_in_unit_range() -> None:
    p = _product(_CLEAN)
    assert 0.0 <= p.popularity_score <= 1.0
    assert 0.0 <= p.freshness_score <= 1.0


def test_malformed_rating_does_not_raise() -> None:
    p = _product(_MALFORMED)
    assert 0.0 <= p.popularity_score <= 1.0
    assert p.freshness_score == 0.0


# ---------------------------------------------------------------------------
# 7. blank breadcrumb -> Uncategorized, row NOT dropped
# ---------------------------------------------------------------------------


def test_blank_breadcrumb_uncategorized() -> None:
    p = _product(_BLANK_CRUMB)
    assert p.category == "Uncategorized"
    assert p.subcategories == []
    assert p.tags == []


# ---------------------------------------------------------------------------
# 8. build-catalog CLI: fixture CSV -> products.jsonl -> valid Products
# ---------------------------------------------------------------------------

_HEADER = (
    "asin,title,about_item,product_description,price_value,list_price,breadcrumbs,"
    "brand_name,manufacturer,rating_stars,rating_count,recent_purchases,all_images,product_url"
)


def _csv_row(r: dict[str, str]) -> str:
    keys = _HEADER.split(",")
    cells = []
    for k in keys:
        v = str(r[k]).replace('"', '""')
        cells.append(f'"{v}"')
    return ",".join(cells)


def _write_fixture_csv(path: Path) -> None:
    rows = [_CLEAN, _FALLBACK_DESC, _BLANK_CRUMB, _MALFORMED]
    lines = [_HEADER, *[_csv_row(r) for r in rows]]
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def test_build_catalog_cli(tmp_path: Path) -> None:
    csv_path = tmp_path / "products.csv"
    out_path = tmp_path / "products.jsonl"
    _write_fixture_csv(csv_path)

    runner = CliRunner()
    result = runner.invoke(app, ["build-catalog", str(csv_path), str(out_path)])
    assert result.exit_code == 0, result.output

    products = load_jsonl(out_path)
    assert len(products) == 4  # no row dropped
    ids = {p.id for p in products}
    assert ids == {"B0CLEAN", "B0FALL", "B0BLANK", "B0BAD"}
    blank = next(p for p in products if p.id == "B0BLANK")
    assert blank.category == "Uncategorized"


def test_build_catalog_handles_embedded_literal_quotes(tmp_path: Path) -> None:
    """Regression: the real Amazon dataset has un-doubled inch-mark quotes inside
    quoted fields (e.g. ``model is 6' 1" tall``) — an RFC4180 violation that desyncs
    a strict chunked CSV parser. build-catalog must still ingest every row.
    """
    csv_path = tmp_path / "products.csv"
    out_path = tmp_path / "products.jsonl"

    keys = _HEADER.split(",")
    # Hand-build a row whose about_item carries a lone embedded double-quote (inch
    # mark) left UN-doubled, exactly like the source data — an RFC4180 violation.
    dirty = {**_CLEAN, "asin": "B0INCH"}
    dirty["about_item"] = "The model in the image is 6' 1\" tall, size 32."
    dirty_line = ",".join(f'"{dirty[k]}"' for k in keys)

    lines = [
        _HEADER,
        _csv_row(_CLEAN),
        dirty_line,
        _csv_row(_FALLBACK_DESC),
    ]
    csv_path.write_text("\r\n".join(lines) + "\r\n", encoding="utf-8")

    runner = CliRunner()
    result = runner.invoke(app, ["build-catalog", str(csv_path), str(out_path)])
    assert result.exit_code == 0, result.output

    products = load_jsonl(out_path)
    ids = {p.id for p in products}
    assert ids == {"B0CLEAN", "B0INCH", "B0FALL"}  # no row lost to a quote desync
