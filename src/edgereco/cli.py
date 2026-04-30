"""Typer CLI for EdgeReco — sync, index, serve, search, preprocess."""

from __future__ import annotations

import json
import shutil
from pathlib import Path
from typing import Annotated

import typer

app = typer.Typer(name="edgereco", help="EdgeReco: edge product discovery engine.")


# ---------------------------------------------------------------------------
# sync
# ---------------------------------------------------------------------------


@app.command()
def sync(
    manifest_url: Annotated[str, typer.Argument(help="URL or path to manifest.json")],
    cache_dir: Annotated[Path, typer.Argument(help="Local cache directory")],
    http: Annotated[bool, typer.Option("--http", help="Force HTTP adapter")] = False,
    filesystem: Annotated[
        bool, typer.Option("--filesystem", help="Force filesystem adapter")
    ] = False,
    file_base_url: Annotated[
        str | None,
        typer.Option(help="Override base URL for file downloads"),
    ] = None,
) -> None:
    """Sync a catalog manifest to CACHE_DIR."""
    from edgereco.catalog.sync import sync_catalog
    from edgereco.edge.adapters.filesystem import FilesystemAdapter
    from edgereco.edge.adapters.http import HttpAdapter

    # Auto-detect adapter from scheme if not forced
    adapter: HttpAdapter | FilesystemAdapter
    if http or (
        not filesystem
        and (manifest_url.startswith("http://") or manifest_url.startswith("https://"))
    ):
        adapter = HttpAdapter()
    else:
        adapter = FilesystemAdapter()

    # Derive file_base_url: strip /manifest.json from the manifest URL/path
    if file_base_url is None:
        if manifest_url.endswith("/manifest.json"):
            file_base_url = manifest_url[: -len("/manifest.json")]
        else:
            file_base_url = str(Path(manifest_url).parent)

    manifest = sync_catalog(
        manifest_url=manifest_url,
        cache_dir=cache_dir,
        client=adapter,
        file_base_url=file_base_url,
    )
    typer.echo(f"Synced catalog '{manifest.catalog_id}' v{manifest.version} → {cache_dir}")


# ---------------------------------------------------------------------------
# index
# ---------------------------------------------------------------------------


@app.command()
def index(
    cache_dir: Annotated[Path, typer.Argument(help="Cache directory with products.jsonl")],
    index_dir: Annotated[Path, typer.Argument(help="Output directory for indexes")],
) -> None:
    """Build vector + keyword indexes from CACHE_DIR/products.jsonl."""
    from edgereco.catalog.loader import load_jsonl
    from edgereco.embeddings.encoder import ProductEncoder
    from edgereco.embeddings.index import VectorIndex

    products_path = cache_dir / "products.jsonl"
    if not products_path.exists():
        typer.echo(f"ERROR: {products_path} not found", err=True)
        raise typer.Exit(1)

    typer.echo(f"Loading products from {products_path}...")
    products = load_jsonl(products_path)
    typer.echo(f"Loaded {len(products)} products.")

    typer.echo("Encoding embeddings (this may take a moment)...")
    encoder = ProductEncoder()
    embeddings = encoder.encode(products)
    ids = [p.id for p in products]
    dim = encoder.dim

    vector_dir = index_dir / "vector"
    vi = VectorIndex.build(embeddings, ids, dim=dim)
    vi.save(vector_dir)
    typer.echo(f"Vector index saved to {vector_dir}  (rows={len(products)}, dim={dim})")

    # Copy products.jsonl to index_dir for keyword rebuild at serve time
    index_dir.mkdir(parents=True, exist_ok=True)
    dest = index_dir / "products.jsonl"
    shutil.copy2(products_path, dest)
    typer.echo(f"Keyword corpus copied to {dest}")


# ---------------------------------------------------------------------------
# serve
# ---------------------------------------------------------------------------


@app.command()
def serve(  # pragma: no cover
    cache_dir: Annotated[Path, typer.Argument(help="Cache directory with products.jsonl")],
    index_dir: Annotated[Path, typer.Argument(help="Directory with vector/ index")],
    host: Annotated[str, typer.Option(help="Bind host")] = "0.0.0.0",  # noqa: S104
    port: Annotated[int, typer.Option(help="Bind port")] = 8000,
) -> None:
    """Start the EdgeReco API server."""
    import uvicorn

    from edgereco.api.app import create_app
    from edgereco.api.deps import ServiceContainer

    container = ServiceContainer.from_dirs(cache_dir, index_dir)
    fastapi_app = create_app(container)
    typer.echo(f"Serving on http://{host}:{port}  (catalog: {len(container.catalog)} products)")
    uvicorn.run(fastapi_app, host=host, port=port)


# ---------------------------------------------------------------------------
# search
# ---------------------------------------------------------------------------


@app.command()
def search(
    query: Annotated[str, typer.Argument(help="Search query")],
    cache_dir: Annotated[Path, typer.Argument(help="Cache directory with products.jsonl")],
    index_dir: Annotated[Path, typer.Argument(help="Directory with vector/ index")],
    limit: Annotated[int, typer.Option(help="Number of results")] = 10,
    category: Annotated[str | None, typer.Option(help="Filter by category")] = None,
    output_json: Annotated[bool, typer.Option("--json", help="Output as JSON")] = False,
) -> None:
    """Search the catalog and print results."""
    from edgereco.api.deps import ServiceContainer
    from edgereco.catalog.models import SearchResult, SessionProfile
    from edgereco.reco.reranker import rerank
    from edgereco.search.hybrid import reciprocal_rank_fusion

    container = ServiceContainer.from_dirs(cache_dir, index_dir)

    k = max(limit * 3, 30)
    keyword_hits = container.keyword.search(query, k=k)
    query_vec = container.encoder.encode_query(query)
    vector_hits = container.vector.search(query_vec, k=k)
    fused = reciprocal_rank_fusion(keyword_hits, vector_hits)

    results: list[SearchResult] = []
    for pid, score in fused:
        product = container.by_id.get(pid)
        if product is not None:
            results.append(SearchResult(product=product, score=score))

    results = rerank(results, SessionProfile())

    if category:
        results = [r for r in results if r.product.category == category]

    results = results[:limit]

    if output_json:
        typer.echo(json.dumps([r.model_dump() for r in results]))
    else:
        typer.echo(f"{'ID':<12} {'Score':>7}  {'Category':<18}  Title")
        typer.echo("-" * 72)
        for r in results:
            typer.echo(
                f"{r.product.id:<12} {r.score:>7.4f}  {r.product.category:<18}  {r.product.title}"
            )


# ---------------------------------------------------------------------------
# preprocess
# ---------------------------------------------------------------------------


DEFAULT_PREPROCESS_CATEGORIES = (
    "Electronics",
    "Clothing",
    "Home & Kitchen",
    "Sports",
    "Books",
)


@app.command()
def preprocess(
    input_path: Annotated[Path, typer.Argument(help="Path to Amazon CSV")],
    output_dir: Annotated[Path, typer.Argument(help="Output directory")],
    limit: Annotated[int, typer.Option(help="Max products to output")] = 10000,
    category: Annotated[
        list[str] | None,
        typer.Option(
            "--category",
            help=("Top-level category to keep (repeatable). Defaults to the 5 demo categories."),
        ),
    ] = None,
) -> None:
    """Convert Amazon CSV to EdgeReco JSONL + manifest."""
    import hashlib

    import polars as pl

    from edgereco.catalog.models import CatalogFile, CatalogManifest
    from edgereco.catalog.preprocessor import amazon_row_to_product

    target_categories = set(category) if category else set(DEFAULT_PREPROCESS_CATEGORIES)

    typer.echo(f"Reading {input_path}...")
    df = pl.read_csv(input_path)

    pop_expr = pl.col("stars").cast(pl.Float64) * (pl.col("reviews").cast(pl.Float64) + 1).log()
    df = df.with_columns([pop_expr.alias("pop_raw")])
    pop_min = float(df["pop_raw"].min() or 0.0)  # type: ignore[arg-type]
    pop_max = float(df["pop_raw"].max() or 1.0)  # type: ignore[arg-type]
    fresh_min = float(df["boughtInLastMonth"].min() or 0.0)  # type: ignore[arg-type]
    fresh_max = float(df["boughtInLastMonth"].max() or 1.0)  # type: ignore[arg-type]

    output_dir.mkdir(parents=True, exist_ok=True)
    out_path = output_dir / "products.jsonl"

    count = 0
    with out_path.open("w", encoding="utf-8") as f:
        for row in df.iter_rows(named=True):
            cat_parts = str(row.get("category_id", "")).split(">")
            top_cat = cat_parts[0].strip() if cat_parts else ""
            if top_cat not in target_categories:
                continue
            product = amazon_row_to_product(
                row,
                pop_min=pop_min,
                pop_max=pop_max,
                fresh_min=fresh_min,
                fresh_max=fresh_max,
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
    (output_dir / "manifest.json").write_text(manifest.model_dump_json(indent=2), encoding="utf-8")
    typer.echo(f"Wrote {count} products to {out_path}")
