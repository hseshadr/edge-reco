"""Integration tests for the Typer CLI."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path

import pytest
from typer.testing import CliRunner

from edgereco.catalog.loader import load_jsonl
from edgereco.catalog.models import CatalogFile, CatalogManifest
from edgereco.cli import app
from edgereco.embeddings.encoder import ProductEncoder
from edgereco.embeddings.index import VectorIndex

runner = CliRunner()

FIXTURES_DIR = Path(__file__).parent.parent / "fixtures"
MINI_CATALOG = FIXTURES_DIR / "mini_catalog.jsonl"


# ---------------------------------------------------------------------------
# Session-scoped fixture: pre-built index dir so encoder only loads once
# ---------------------------------------------------------------------------


@pytest.fixture(scope="session")
def cli_index_dirs(tmp_path_factory: pytest.TempPathFactory) -> tuple[Path, Path]:
    """Build cache_dir + index_dir from mini_catalog once per session."""
    import shutil

    base = tmp_path_factory.mktemp("cli_session")
    cache_dir = base / "cache"
    index_dir = base / "index"
    cache_dir.mkdir()

    # Copy mini_catalog as products.jsonl
    shutil.copy2(MINI_CATALOG, cache_dir / "products.jsonl")

    # Write a minimal manifest.json so from_dirs can parse it
    products_path = cache_dir / "products.jsonl"
    checksum = "sha256:" + hashlib.sha256(products_path.read_bytes()).hexdigest()
    products = load_jsonl(products_path)
    manifest = CatalogManifest(
        catalog_id="test-catalog",
        version="2026-04-24T00:00:00Z",
        embedding_model="sentence-transformers/all-MiniLM-L6-v2",
        embedding_dim=384,
        files=[
            CatalogFile(
                path="products.jsonl", file_type="products", checksum=checksum, rows=len(products)
            )
        ],
    )
    (cache_dir / "manifest.json").write_text(manifest.model_dump_json(indent=2), encoding="utf-8")

    # Build index directly (avoids running CLI for this setup step)
    encoder = ProductEncoder()
    embeddings = encoder.encode(products)
    ids = [p.id for p in products]
    vi = VectorIndex.build(embeddings, ids, dim=encoder.dim)
    vi.save(index_dir / "vector")

    # Copy products.jsonl to index_dir (mirrors what `edgereco index` does)
    shutil.copy2(products_path, index_dir / "products.jsonl")

    return cache_dir, index_dir


# ---------------------------------------------------------------------------
# test_cli_help
# ---------------------------------------------------------------------------


def test_cli_help() -> None:
    result = runner.invoke(app, ["--help"])
    assert result.exit_code == 0
    for cmd in ("sync", "index", "serve", "search", "preprocess"):
        assert cmd in result.output


# ---------------------------------------------------------------------------
# test_cli_sync
# ---------------------------------------------------------------------------


def test_cli_sync(tmp_path: Path) -> None:
    # Build a minimal origin directory
    origin = tmp_path / "origin"
    origin.mkdir()
    products_content = (MINI_CATALOG).read_bytes()
    (origin / "products.jsonl").write_bytes(products_content)
    checksum = "sha256:" + hashlib.sha256(products_content).hexdigest()

    catalog_file = CatalogFile(
        path="products.jsonl", file_type="products", checksum=checksum, rows=50
    )
    manifest = CatalogManifest(
        catalog_id="test",
        version="2026-01-01T00:00:00Z",
        embedding_model="sentence-transformers/all-MiniLM-L6-v2",
        embedding_dim=384,
        files=[catalog_file],
    )
    manifest_path = origin / "manifest.json"
    manifest_path.write_text(manifest.model_dump_json(indent=2), encoding="utf-8")

    cache_dir = tmp_path / "cache"

    result = runner.invoke(
        app,
        ["sync", str(manifest_path), str(cache_dir), "--filesystem"],
    )

    assert result.exit_code == 0, result.output
    assert (cache_dir / "products.jsonl").exists()
    assert (cache_dir / "manifest.json").exists()


# ---------------------------------------------------------------------------
# test_cli_index
# ---------------------------------------------------------------------------


def test_cli_index(tmp_path: Path) -> None:
    import shutil

    cache_dir = tmp_path / "cache"
    cache_dir.mkdir()
    shutil.copy2(MINI_CATALOG, cache_dir / "products.jsonl")

    index_dir = tmp_path / "index"

    result = runner.invoke(app, ["index", str(cache_dir), str(index_dir)])

    assert result.exit_code == 0, result.output
    assert (index_dir / "vector" / "index.faiss").exists()
    assert (index_dir / "vector" / "id_map.json").exists()


# ---------------------------------------------------------------------------
# test_cli_search
# ---------------------------------------------------------------------------


def test_cli_search(cli_index_dirs: tuple[Path, Path]) -> None:
    cache_dir, index_dir = cli_index_dirs

    result = runner.invoke(
        app,
        [
            "search",
            "wireless headphones",
            str(cache_dir),
            str(index_dir),
            "--limit",
            "3",
            "--json",
        ],
    )

    assert result.exit_code == 0, result.output
    # sentence-transformers emits tqdm progress bars that contain '[' chars
    # (e.g. "[00:00<?, ?it/s]").  The real JSON array starts with "[{".
    raw = result.output
    start = raw.find("[{")
    assert start != -1, f"No JSON array found in output:\n{raw!r}"
    data = json.loads(raw[start:].rstrip())
    assert isinstance(data, list)
    assert len(data) == 3
    # Verify correct shape — each entry has product + score
    assert all("product" in item and "score" in item for item in data)
    # All results should be Electronics (headphones query)
    categories = [item["product"]["category"] for item in data]
    assert "Electronics" in categories


# ---------------------------------------------------------------------------
# test_cli_preprocess_help
# ---------------------------------------------------------------------------


def test_cli_preprocess_help() -> None:
    result = runner.invoke(app, ["preprocess", "--help"])
    assert result.exit_code == 0
    assert "INPUT" in result.output or "input" in result.output.lower()
