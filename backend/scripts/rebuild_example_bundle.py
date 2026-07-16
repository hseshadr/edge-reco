"""Re-sign the committed ``examples/catalog`` bundle from its own contents.

Materializes the current signed bundle into a staging dir, drops in the current
``DEFAULT_RANKING_CONFIG`` (so a config retune — e.g. Phase-2's strategy map, Phase-3's
co-occurrence strategies — flows into the seed bundle) plus the seed ``cooccurrence.json``
computed from the committed demo session log, and republishes. ``products.jsonl`` and
the prebuilt ``vector/`` are carried verbatim, so only ``ranking_config.json`` +
``cooccurrence.json`` content + the manifest/chunk layout change; the catalog and FAISS
index stay byte-identical.

Run from backend/ (regenerate the demo sessions first if they changed)::

    .venv/bin/python3 scripts/gen_demo_sessions.py
    .venv/bin/python3 scripts/rebuild_example_bundle.py

Then mirror the result into the browser parity fixture (the browser syncs this copy)::

    rm -rf ../frontend/packages/edgeproc-browser/src/engine/__fixtures__/bundle/catalog
    cp -R examples/catalog \
        ../frontend/packages/edgeproc-browser/src/engine/__fixtures__/bundle/catalog
"""

from __future__ import annotations

import glob
import hashlib
import json
import shutil
from pathlib import Path

import zstandard as zstd

from edgereco.catalog.publish import publish_bundle
from edgereco.reco.cooccurrence import (
    CooccurrenceMatrix,
    SessionLog,
    build_cooccurrence,
    sessions_from_logs,
)
from edgereco.reco.ranking_config import DEFAULT_RANKING_CONFIG

BACKEND_ROOT = Path(__file__).resolve().parent.parent
CATALOG = BACKEND_ROOT / "examples" / "catalog"
DEMO_SESSIONS = BACKEND_ROOT / "examples" / "source" / "demo_sessions.jsonl"
KEY = BACKEND_ROOT / "examples" / "keys" / "private.key"
CATALOG_ID = "amazon-demo"
VERSION = "v1"
EMBEDDING_MODEL = "sentence-transformers/all-MiniLM-L6-v2"
DIM = 384


def _manifest() -> dict[str, object]:
    return json.loads(Path(glob.glob(str(CATALOG / "manifest" / "*"))[0]).read_bytes())


def _materialize(path: str) -> bytes:
    entry = next(f for f in _manifest()["files"] if f["path"] == path)  # type: ignore[index]
    dctx = zstd.ZstdDecompressor()
    parts = [dctx.decompress((CATALOG / "chunk" / r["hash"]).read_bytes()) for r in entry["chunks"]]
    blob = b"".join(parts)
    if hashlib.sha256(blob).hexdigest() != entry["file_sha256"]:
        raise ValueError(f"{path} failed reassembly check")
    return blob


def _stage(staging: Path) -> int:
    """Materialize products + vector verbatim into ``staging``; return product count."""
    (staging / "vector").mkdir(parents=True, exist_ok=True)
    products = _materialize("products.jsonl")
    (staging / "products.jsonl").write_bytes(products)
    for name in ("embeddings.f32", "index.faiss", "state.json"):
        (staging / "vector" / name).write_bytes(_materialize(f"vector/{name}"))
    # Drop in the CURRENT default ranking config (carries the Phase-2/3 strategy map).
    (staging / "ranking_config.json").write_text(
        DEFAULT_RANKING_CONFIG.model_dump_json(), encoding="utf-8"
    )
    # Compute the seed co-occurrence from the committed demo session log.
    (staging / "cooccurrence.json").write_text(
        _seed_cooccurrence().model_dump_json(), encoding="utf-8"
    )
    return len([line for line in products.splitlines() if line.strip()])


def _seed_cooccurrence() -> CooccurrenceMatrix:
    """Build the seed co-occurrence matrix from ``demo_sessions.jsonl`` (labeled demo data)."""
    logs = [
        SessionLog.model_validate_json(line)
        for line in DEMO_SESSIONS.read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]
    return build_cooccurrence(sessions_from_logs(logs))


def main() -> None:
    staging = CATALOG.parent / "_staging_rebuild"
    if staging.exists():
        shutil.rmtree(staging)
    count = _stage(staging)
    for sub in ("manifest", "chunk"):
        shutil.rmtree(CATALOG / sub, ignore_errors=True)
    (CATALOG / "latest").unlink(missing_ok=True)
    publish_bundle(
        staging_dir=staging,
        origin_dir=CATALOG,
        private_key_path=KEY,
        catalog_id=CATALOG_ID,
        version=VERSION,
        embedding_model=EMBEDDING_MODEL,
        embedding_dim=DIM,
        embedding_count=count,
        product_count=count,
        sequence=1,
    )
    shutil.rmtree(staging)
    _drop_producer_scratch()
    print(f"rebuilt {CATALOG} with strategy-map ranking_config ({count} products)")


def _drop_producer_scratch() -> None:
    """Remove the producer-side CAS dirs (``chunks/``, ``manifests/``, ``active``).

    ``build_bundle`` lays out the flat ``chunk/`` + ``manifest/`` + ``latest`` origin
    the CDN serves *and* leaves its internal sharded store beside it. Only the flat
    origin belongs in the committed bundle, so the scratch dirs are dropped here.
    """
    shutil.rmtree(CATALOG / "chunks", ignore_errors=True)
    shutil.rmtree(CATALOG / "manifests", ignore_errors=True)
    (CATALOG / "active").unlink(missing_ok=True)


if __name__ == "__main__":
    main()
