"""Preprocess Amazon Kaggle CSV into EdgeReco catalog format.

Usage:
    uv run python examples/scripts/preprocess_amazon.py products.csv examples/catalog/ --limit 10000
"""
from __future__ import annotations

import hashlib
from pathlib import Path
from typing import Annotated

import polars as pl
import typer

from edgereco.catalog.models import CatalogFile, CatalogManifest
from edgereco.catalog.preprocessor import amazon_row_to_product

app = typer.Typer()

TARGET_CATEGORIES = {"Electronics", "Clothing", "Home & Kitchen", "Sports", "Books"}


@app.command()
def preprocess(
    input_path: Annotated[Path, typer.Argument(help="Path to Amazon CSV")],
    output_dir: Annotated[Path, typer.Argument(help="Output directory")],
    limit: Annotated[int, typer.Option(help="Max products to output")] = 10000,
) -> None:
    """Convert Amazon CSV to EdgeReco JSONL + manifest."""
    typer.echo(f"Reading {input_path}...")
    df = pl.read_csv(input_path)

    pop_expr = (
        pl.col("stars").cast(pl.Float64)
        * (pl.col("reviews").cast(pl.Float64) + 1).log()
    )
    df = df.with_columns([pop_expr.alias("pop_raw")])
    pop_min = float(df["pop_raw"].min() or 0)
    pop_max = float(df["pop_raw"].max() or 1)
    fresh_min = float(df["boughtInLastMonth"].min() or 0)
    fresh_max = float(df["boughtInLastMonth"].max() or 1)

    output_dir.mkdir(parents=True, exist_ok=True)
    out_path = output_dir / "products.jsonl"

    count = 0
    with out_path.open("w", encoding="utf-8") as f:
        for row in df.iter_rows(named=True):
            cat_parts = str(row.get("category_id", "")).split(">")
            top_cat = cat_parts[0].strip() if cat_parts else ""
            if top_cat not in TARGET_CATEGORIES:
                continue
            product = amazon_row_to_product(
                row, pop_min=pop_min, pop_max=pop_max,
                fresh_min=fresh_min, fresh_max=fresh_max,
            )
            f.write(product.model_dump_json() + "\n")
            count += 1
            if count >= limit:
                break

    checksum = "sha256:" + hashlib.sha256(out_path.read_bytes()).hexdigest()
    catalog_file = CatalogFile(
        path="products.jsonl", file_type="products", checksum=checksum, rows=count
    )
    manifest = CatalogManifest(
        catalog_id="amazon-demo",
        version="2026-04-24T00:00:00Z",
        embedding_model="sentence-transformers/all-MiniLM-L6-v2",
        embedding_dim=384,
        files=[catalog_file],
    )
    (output_dir / "manifest.json").write_text(
        manifest.model_dump_json(indent=2), encoding="utf-8"
    )
    typer.echo(f"Wrote {count} products to {out_path}")


if __name__ == "__main__":
    app()
