"""Producer: build a signed, content-addressed bundle of a built catalog.

A thin domain wrapper over edge-proc's ``build_bundle``. Given a *staging dir*
(``products.jsonl`` + a saved FAISS ``vector/`` dir) and a private key, it writes
``catalog_meta.json``, reads every bundle file into ``{relpath: bytes}``, and lets
edge-proc chunk + sign + lay out the flat origin a device can ``sync_index``.

The bundle CONTRACT (what the consumer wave's ``from_synced`` relies on):

- ``products.jsonl`` — the catalog (preprocess output).
- ``vector/<faiss files>`` — the prebuilt FAISS index, verbatim, under ``vector/``
  (zero recompute on the edge).
- ``catalog_meta.json`` — domain metadata: ``catalog_id``, ``version``,
  ``embedding_model``, ``embedding_dim``, ``product_count``.

edge-proc stays generic (opaque files only); this module owns the domain shape.
"""

from __future__ import annotations

from pathlib import Path
from typing import Final

from edgeproc.bundles.cas import FilesystemCacheStore
from edgeproc.bundles.chunking import GearCDC
from edgeproc.bundles.publish import build_bundle
from edgeproc.bundles.signing import Ed25519Signer
from pydantic import BaseModel

# Logical top-level entries a bundle staging dir must provide; ``vector`` is a dir.
BUNDLE_FILES: Final[tuple[str, str, str]] = ("products.jsonl", "vector", "catalog_meta.json")
_META_NAME: Final[str] = "catalog_meta.json"


class CatalogMeta(BaseModel):
    """Domain metadata bundled as ``catalog_meta.json`` (typed JSON)."""

    catalog_id: str
    version: str
    embedding_model: str
    embedding_dim: int
    embedding_count: int
    product_count: int


def publish_bundle(
    *,
    staging_dir: Path,
    origin_dir: Path,
    private_key_path: Path,
    catalog_id: str,
    version: str,
    embedding_model: str,
    embedding_dim: int,
    embedding_count: int,
    product_count: int,
) -> None:
    """Write ``catalog_meta.json`` then build the signed origin from the staging dir."""
    meta = CatalogMeta(
        catalog_id=catalog_id,
        version=version,
        embedding_model=embedding_model,
        embedding_dim=embedding_dim,
        embedding_count=embedding_count,
        product_count=product_count,
    )
    (staging_dir / _META_NAME).write_text(meta.model_dump_json(), encoding="utf-8")
    files = _read_bundle_files(staging_dir)
    signer = Ed25519Signer.from_private_bytes(private_key_path.read_bytes())
    origin_dir.mkdir(parents=True, exist_ok=True)
    build_bundle(
        files=files,
        store=FilesystemCacheStore(origin_dir),
        chunker=GearCDC(),
        signer=signer,
        bundle_id=catalog_id,
        version=version,
    )


def _read_bundle_files(staging_dir: Path) -> dict[str, bytes]:
    """Read every bundle file into ``{relpath: bytes}`` (vector/ recursed)."""
    files: dict[str, bytes] = {
        "products.jsonl": (staging_dir / "products.jsonl").read_bytes(),
        _META_NAME: (staging_dir / _META_NAME).read_bytes(),
    }
    for path in sorted((staging_dir / "vector").rglob("*")):
        if path.is_file():
            rel = path.relative_to(staging_dir).as_posix()
            files[rel] = path.read_bytes()
    return files
