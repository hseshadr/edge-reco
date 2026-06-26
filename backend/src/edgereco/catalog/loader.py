"""Load product catalogs from JSONL."""

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


def dump_jsonl(path: Path, products: list[Product]) -> None:
    """Write products to a JSONL file (one JSON object per line)."""
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as handle:
        for product in products:
            handle.write(product.model_dump_json() + "\n")
