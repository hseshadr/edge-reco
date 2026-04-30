"""Focused CLI tests to close coverage gaps on cli.py."""
from __future__ import annotations

import shutil
from pathlib import Path

import pytest
from typer.testing import CliRunner

from edgereco.catalog.loader import load_jsonl
from edgereco.cli import app
from edgereco.embeddings.encoder import ProductEncoder
from edgereco.embeddings.index import VectorIndex

runner = CliRunner()

FIXTURES_DIR = Path(__file__).parent.parent / "fixtures"
MINI_CATALOG = FIXTURES_DIR / "mini_catalog.jsonl"


# ---------------------------------------------------------------------------
# Shared index fixture
# ---------------------------------------------------------------------------


@pytest.fixture(scope="module")
def index_dirs(tmp_path_factory: pytest.TempPathFactory) -> tuple[Path, Path]:
    import hashlib

    from edgereco.catalog.models import CatalogFile, CatalogManifest

    base = tmp_path_factory.mktemp("cli_cov")
    cache_dir = base / "cache"
    index_dir = base / "index"
    cache_dir.mkdir()
    shutil.copy2(MINI_CATALOG, cache_dir / "products.jsonl")
    products_path = cache_dir / "products.jsonl"
    products = load_jsonl(products_path)

    # Write a minimal manifest.json so from_dirs can parse it
    checksum = "sha256:" + hashlib.sha256(products_path.read_bytes()).hexdigest()
    manifest = CatalogManifest(
        catalog_id="test-catalog",
        version="2026-04-24T00:00:00Z",
        embedding_model="sentence-transformers/all-MiniLM-L6-v2",
        embedding_dim=384,
        files=[CatalogFile(
            path="products.jsonl", file_type="products", checksum=checksum, rows=len(products)
        )],
    )
    (cache_dir / "manifest.json").write_text(manifest.model_dump_json(indent=2), encoding="utf-8")

    encoder = ProductEncoder()
    embeddings = encoder.encode(products)
    vi = VectorIndex.build(embeddings, [p.id for p in products], dim=encoder.dim)
    vi.save(index_dir / "vector")
    shutil.copy2(products_path, index_dir / "products.jsonl")
    return cache_dir, index_dir


# ---------------------------------------------------------------------------
# index: missing-products-file error path (lines 85-86)
# ---------------------------------------------------------------------------


def test_cli_index_missing_products_exits_nonzero(tmp_path: Path) -> None:
    result = runner.invoke(app, ["index", str(tmp_path), str(tmp_path / "index")])
    assert result.exit_code != 0
    assert "ERROR" in result.output or "not found" in result.output


# ---------------------------------------------------------------------------
# search: non-JSON table output (lines 219-222)
# ---------------------------------------------------------------------------


def test_cli_search_table_output(index_dirs: tuple[Path, Path]) -> None:
    cache_dir, index_dir = index_dirs
    result = runner.invoke(
        app,
        ["search", "laptop", str(cache_dir), str(index_dir), "--limit", "3"],
    )
    assert result.exit_code == 0, result.output
    assert "Score" in result.output or "ID" in result.output


# ---------------------------------------------------------------------------
# search: category filter (line 212)
# ---------------------------------------------------------------------------


def test_cli_search_category_filter(index_dirs: tuple[Path, Path]) -> None:
    cache_dir, index_dir = index_dirs
    result = runner.invoke(
        app,
        ["search", "book", str(cache_dir), str(index_dir), "--limit", "5", "--category", "Books"],
    )
    assert result.exit_code == 0, result.output


# ---------------------------------------------------------------------------
# preprocess: converts CSV to JSONL + manifest (lines 240-298)
# ---------------------------------------------------------------------------

_AMAZON_CSV = """\
asin,title,stars,reviews,price,boughtInLastMonth,category_id,imgUrl,productURL
B001,Wireless Headphones,4.5,1200,29.99,300,Electronics > Audio,http://img1,http://url1
B002,Running Shoes,4.2,800,59.99,150,Sports > Footwear,http://img2,http://url2
B003,Cooking Pot,4.0,500,39.99,80,Home & Kitchen > Cookware,http://img3,http://url3
B004,Irrelevant Widget,3.5,100,9.99,10,Automotive > Parts,http://img4,http://url4
"""


def test_cli_preprocess_writes_jsonl_and_manifest(tmp_path: Path) -> None:
    csv_path = tmp_path / "amazon.csv"
    csv_path.write_text(_AMAZON_CSV, encoding="utf-8")
    out_dir = tmp_path / "out"

    result = runner.invoke(app, ["preprocess", str(csv_path), str(out_dir)])

    assert result.exit_code == 0, result.output
    jsonl_path = out_dir / "products.jsonl"
    manifest_path = out_dir / "manifest.json"
    assert jsonl_path.exists()
    assert manifest_path.exists()

    lines = [ln for ln in jsonl_path.read_text().splitlines() if ln.strip()]
    # 3 rows match target categories; B004 (Automotive) is filtered out
    assert len(lines) == 3
    assert "Wrote 3 products" in result.output


def test_cli_preprocess_respects_limit(tmp_path: Path) -> None:
    csv_path = tmp_path / "amazon.csv"
    csv_path.write_text(_AMAZON_CSV, encoding="utf-8")
    out_dir = tmp_path / "out"

    result = runner.invoke(app, ["preprocess", str(csv_path), str(out_dir), "--limit", "1"])

    assert result.exit_code == 0, result.output
    lines = [ln for ln in (out_dir / "products.jsonl").read_text().splitlines() if ln.strip()]
    assert len(lines) == 1
