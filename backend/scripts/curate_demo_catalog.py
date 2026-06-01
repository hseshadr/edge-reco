"""Curate a balanced, multi-category demo catalog from a real Amazon dataset.

A memory-bounded streaming processor: it scans the source parquet lazily and
projects ONLY the columns it needs — it never materializes the 1.58 GB
``embeddings`` column — keeps well-formed rows (price + feature bullets + store +
breadcrumbs + image), then deterministically takes the top ``--per-category``
products (by popularity) from each of the top ``--categories`` breadcrumb roots.

The output ``examples/source/catalog.csv`` is the committed, reproducible source
for the signed bundle: anyone can ``build-catalog -> index -> bundle`` from it
offline, with no parquet on disk. Columns match ``scraped_row_to_product`` exactly
(catalog/preprocessor.py), so the build pipeline needs no changes.

Run from backend/::

    .venv/bin/python3 scripts/curate_demo_catalog.py
    .venv/bin/python3 scripts/curate_demo_catalog.py --source /path/to/amazon.parquet
"""

from __future__ import annotations

import argparse
import csv
from datetime import date, datetime
from pathlib import Path

import polars as pl
from pydantic import BaseModel

from edgereco.catalog.preprocessor import BREADCRUMB_SEP

BACKEND_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_SOURCE = Path.home() / "Downloads" / "amazon_products.parquet"
DEFAULT_OUTPUT = BACKEND_ROOT / "examples" / "source" / "catalog.csv"
DEFAULT_CATEGORIES = 12
DEFAULT_PER_CATEGORY = 60
# Amazon's canonical product-page URL; {asin} is the only path segment that varies.
PRODUCT_URL_TEMPLATE = "https://www.amazon.com/dp/{asin}"
# Freshness is a recency rank: days since this epoch, normalized by build-catalog.
FRESHNESS_EPOCH = date(2000, 1, 1)
_SOURCE_COLUMNS = (
    "parent_asin",
    "title",
    "features",
    "categories",
    "store",
    "price",
    "average_rating",
    "rating_number",
    "date_first_available",
    "image",
)


class CuratedRow(BaseModel):
    """One output CSV row in the scraped-Amazon schema build-catalog consumes."""

    asin: str
    title: str
    about_item: str
    breadcrumbs: str
    brand_name: str
    price_value: str
    rating_stars: str
    rating_count: str
    recent_purchases: str
    all_images: str
    product_url: str


def _well_formed(lf: pl.LazyFrame) -> pl.LazyFrame:
    """Keep only rows with the fields the reranker and storefront need."""
    return lf.filter(
        pl.col("price").is_not_null()
        & (pl.col("features").list.len() > 0)
        & pl.col("store").is_not_null()
        & (pl.col("store") != "")
        & (pl.col("categories").list.len() > 0)
        & pl.col("image").is_not_null()
        & (pl.col("image") != "")
    )


def _popularity(stars: pl.Expr, count: pl.Expr) -> pl.Expr:
    """Selection score mirroring compute_scraped_popularity_raw (stars * ln(1+count))."""
    return stars * (count + 1).log()


def _load_source(source: Path) -> pl.DataFrame:
    """Stream the parquet, projecting only needed columns (never the embeddings)."""
    lf = _well_formed(pl.scan_parquet(source).select(_SOURCE_COLUMNS))
    enriched = lf.with_columns(
        pl.col("categories").list.first().alias("root"),
        _popularity(
            pl.col("average_rating").cast(pl.Float64, strict=False).fill_null(0.0),
            pl.col("rating_number").cast(pl.Float64, strict=False).fill_null(0.0),
        ).alias("pop"),
    )
    return enriched.collect(engine="streaming")


def _top_categories(df: pl.DataFrame, count: int) -> list[str]:
    """The `count` most-populated breadcrumb roots (deterministic: count, then name)."""
    counts = df.group_by("root").agg(pl.len().alias("n"))
    ranked = counts.sort(["n", "root"], descending=[True, False])
    return ranked.head(count)["root"].to_list()


def _select_balanced(df: pl.DataFrame, roots: list[str], per_category: int) -> pl.DataFrame:
    """Top `per_category` products by popularity within each chosen breadcrumb root."""
    return (
        df.filter(pl.col("root").is_in(roots))
        .sort(["root", "pop", "parent_asin"], descending=[False, True, False])
        .group_by("root", maintain_order=True)
        .head(per_category)
    )


def _recent_purchases(raw: object) -> str:
    """A recency-monotonic integer (days since FRESHNESS_EPOCH) feeding freshness; 0 if unknown."""
    text = str(raw or "").strip()
    if not text:
        return "0"
    try:
        parsed = datetime.fromisoformat(text)
    except ValueError:
        return "0"
    return str(parsed.date().toordinal() - FRESHNESS_EPOCH.toordinal())


def _str_list(value: object) -> list[str]:
    """Narrow a parquet list cell to a list of strings (empty for anything else)."""
    if isinstance(value, (list, tuple)):
        return [str(item) for item in value]
    return []


def _to_row(record: dict[str, object]) -> CuratedRow:
    """Map one source record to the scraped-Amazon CSV schema."""
    asin = str(record["parent_asin"])
    return CuratedRow(
        asin=asin,
        title=str(record.get("title") or ""),
        about_item=" ".join(_str_list(record.get("features"))),
        breadcrumbs=f" {BREADCRUMB_SEP} ".join(_str_list(record.get("categories"))),
        brand_name=str(record.get("store") or ""),
        price_value=str(record.get("price") or ""),
        rating_stars=str(record.get("average_rating") or ""),
        rating_count=str(record.get("rating_number") or ""),
        recent_purchases=_recent_purchases(record.get("date_first_available")),
        all_images=repr([str(record.get("image") or "")]),
        product_url=PRODUCT_URL_TEMPLATE.format(asin=asin),
    )


def _write_csv(rows: list[CuratedRow], output: Path) -> None:
    output.parent.mkdir(parents=True, exist_ok=True)
    with output.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(CuratedRow.model_fields))
        writer.writeheader()
        for row in rows:
            writer.writerow(row.model_dump())


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, default=DEFAULT_SOURCE)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--categories", type=int, default=DEFAULT_CATEGORIES)
    parser.add_argument("--per-category", type=int, default=DEFAULT_PER_CATEGORY)
    return parser.parse_args()


def main() -> None:
    args = _parse_args()
    print(f"Streaming {args.source} (projecting {len(_SOURCE_COLUMNS)} columns)...")
    df = _load_source(args.source)
    roots = _top_categories(df, args.categories)
    selected = _select_balanced(df, roots, args.per_category)
    rows = [_to_row(record) for record in selected.iter_rows(named=True)]
    _write_csv(rows, args.output)
    print(f"Wrote {len(rows)} products across {len(roots)} categories to {args.output}")
    print("Categories: " + ", ".join(roots))


if __name__ == "__main__":
    main()
