"""Integration test: the ``edgereco retrain`` CLI command wiring.

Drives the command against a local filesystem origin with no collector (engagement
omitted), asserting it loads the verify key, republishes a bumped version, and
reports the outcome. Boosting behaviour is covered by ``test_republish.py``.
"""

from __future__ import annotations

from pathlib import Path

from edgeproc.bundles.signing import generate_keypair
from typer.testing import CliRunner

from edgereco.catalog.loader import dump_jsonl
from edgereco.catalog.models import Product
from edgereco.catalog.publish import publish_bundle
from edgereco.cli import app

runner = CliRunner()


def _seed_origin(tmp: Path, private_key_path: Path) -> Path:
    staging = tmp / "seed"
    (staging / "vector").mkdir(parents=True)
    dump_jsonl(staging / "products.jsonl", [Product(id="P1", title="A", category="Electronics")])
    (staging / "vector" / "embeddings.f32").write_bytes(b"\x00" * 16)
    origin = tmp / "origin"
    publish_bundle(
        staging_dir=staging,
        origin_dir=origin,
        private_key_path=private_key_path,
        catalog_id="cli-retrain-test",
        version="v1",
        embedding_model="sentence-transformers/all-MiniLM-L6-v2",
        embedding_dim=384,
        embedding_count=1,
        product_count=1,
    )
    return origin


def test_retrain_command_republishes_bumped_version(tmp_path: Path) -> None:
    private, public = generate_keypair()
    private_key = tmp_path / "private.key"
    public_key = tmp_path / "public.key"
    private_key.write_bytes(private.private_bytes_raw())
    public_key.write_bytes(public.public_bytes_raw())
    origin = _seed_origin(tmp_path, private_key)

    result = runner.invoke(
        app,
        [
            "retrain",
            str(origin),
            str(origin),
            str(private_key),
            str(public_key),
            "--cache-dir",
            str(tmp_path / "cache"),
        ],
    )

    assert result.exit_code == 0, result.output
    assert "v2" in result.output
