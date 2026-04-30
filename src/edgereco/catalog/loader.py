"""Load product catalogs from various file formats."""
from __future__ import annotations

from pathlib import Path

from .models import Product


def load_jsonl(path: Path) -> list[Product]:
    """Load products from a JSONL file (one JSON object per line)."""
    products: list[Product] = []
    text = path.read_text(encoding="utf-8").strip()
    if not text:
        return products
    for line in text.splitlines():
        line = line.strip()
        if line:
            products.append(Product.model_validate_json(line))
    return products


def load_csv(path: Path, *, limit: int | None = None) -> list[Product]:
    """Load products from a CSV file using Polars for performance."""
    import polars as pl

    df = pl.read_csv(path, n_rows=limit)
    products: list[Product] = []
    for row in df.iter_rows(named=True):
        products.append(Product.model_validate(row))
    return products
