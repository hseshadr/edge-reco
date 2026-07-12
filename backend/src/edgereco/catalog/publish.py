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
- ``ranking_config.json`` — the typed ranking weights (``reco.ranking_config``).
  Consumers read the scorer's weights from here; absent (a pre-config staging
  dir), the producer writes ``DEFAULT_RANKING_CONFIG``, the byte-identical legacy
  weights, so re-bundling never changes scores.
- ``cooccurrence.json`` — the item-to-item co-occurrence neighbour map
  (``reco.cooccurrence``). Co-occurrence strategies read it; absent, the producer
  writes an empty matrix so older bundles degrade gracefully.

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

from edgereco.reco.cooccurrence import CooccurrenceMatrix
from edgereco.reco.ranking_config import DEFAULT_RANKING_CONFIG, RankingConfig

# Logical top-level entries a bundle staging dir must provide; ``vector`` is a dir.
BUNDLE_FILES: Final[tuple[str, ...]] = (
    "products.jsonl",
    "vector",
    "catalog_meta.json",
    "ranking_config.json",
    "cooccurrence.json",
)
_META_NAME: Final[str] = "catalog_meta.json"
_RANKING_NAME: Final[str] = "ranking_config.json"
_COOCCURRENCE_NAME: Final[str] = "cooccurrence.json"

#: Meta schema bumped to 2 once the bundle began carrying ``ranking_config.json`` +
#: ``cooccurrence.json``. A pre-feature ``catalog_meta.json`` has no ``schema_version``
#: field and so reads back as ``1`` (legacy); a current bundle stamps this value. The
#: gap lets a consumer tell "older bundle predates this file" (default is correct) from
#: "current bundle is unexpectedly missing a file it should have" (corruption — raise).
CURRENT_META_SCHEMA: Final[int] = 2


class CatalogMeta(BaseModel):
    """Domain metadata bundled as ``catalog_meta.json`` (typed JSON).

    ``schema_version`` defaults to ``1`` so a pre-feature bundle (no such field) parses
    unchanged — the committed bundle stays byte-stable. A fresh publish stamps
    ``CURRENT_META_SCHEMA``.
    """

    catalog_id: str
    version: str
    embedding_model: str
    embedding_dim: int
    embedding_count: int
    product_count: int
    schema_version: int = 1


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
    require_feature_files: bool = False,
) -> None:
    """Write ``catalog_meta.json`` then build the signed origin from the staging dir.

    ``require_feature_files`` republishes a CURRENT bundle: ``ranking_config.json`` and
    ``cooccurrence.json`` MUST already be staged (a retrain re-staging a synced bundle),
    so a missing file raises instead of silently baking in legacy defaults. A fresh
    build leaves it ``False`` and the producer writes the defaults for the first time.
    """
    meta = CatalogMeta(
        catalog_id=catalog_id,
        version=version,
        embedding_model=embedding_model,
        embedding_dim=embedding_dim,
        embedding_count=embedding_count,
        product_count=product_count,
        schema_version=CURRENT_META_SCHEMA,
    )
    (staging_dir / _META_NAME).write_text(meta.model_dump_json(), encoding="utf-8")
    _ensure_ranking_config(staging_dir, require_present=require_feature_files)
    _ensure_cooccurrence(staging_dir, require_present=require_feature_files)
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


def _ensure_ranking_config(staging_dir: Path, *, require_present: bool = False) -> None:
    """Materialize ``ranking_config.json`` in the staging dir if it's absent.

    A staging dir carried over from a synced bundle keeps its config verbatim; a
    fresh build gets ``DEFAULT_RANKING_CONFIG`` — the legacy weights — so a first
    publish never silently changes ranking. When ``require_present`` (republishing a
    CURRENT bundle), a missing file is a corruption signal and raises rather than
    silently baking the default into a freshly-signed bundle.
    """
    ranking_path = staging_dir / _RANKING_NAME
    if ranking_path.exists():
        RankingConfig.model_validate_json(ranking_path.read_bytes())
        return
    if require_present:
        raise FileNotFoundError(
            f"{ranking_path} missing from a current-schema bundle; refusing to "
            "silently republish with legacy default weights"
        )
    ranking_path.write_text(DEFAULT_RANKING_CONFIG.model_dump_json(), encoding="utf-8")


def _ensure_cooccurrence(staging_dir: Path, *, require_present: bool = False) -> None:
    """Materialize ``cooccurrence.json`` if absent; default is an empty matrix.

    A staging dir carried over from a synced bundle keeps its matrix verbatim; a
    fresh build (or a catalog with no interaction data) gets an empty
    ``CooccurrenceMatrix``. When ``require_present`` (republishing a CURRENT bundle),
    a missing file raises instead of silently degrading to an empty matrix.
    """
    cooc_path = staging_dir / _COOCCURRENCE_NAME
    if cooc_path.exists():
        CooccurrenceMatrix.model_validate_json(cooc_path.read_bytes())
        return
    if require_present:
        raise FileNotFoundError(
            f"{cooc_path} missing from a current-schema bundle; refusing to "
            "silently republish with an empty co-occurrence matrix"
        )
    cooc_path.write_text(CooccurrenceMatrix().model_dump_json(), encoding="utf-8")


def _refuse_symlink(path: Path, staging_dir: Path) -> None:
    """Fail closed if ``path`` is a symlink, BEFORE anything follows it.

    A symlinked staging entry — a fixed-name top-level file or one nested under
    ``vector/`` — would let ``read_bytes()``/``is_file()`` follow the link and inline
    an arbitrary host file into the SIGNED, world-readable bundle (arbitrary-file
    read). Refuse it rather than sign whatever the link points at.
    """
    if path.is_symlink():
        rel = path.relative_to(staging_dir).as_posix()
        raise ValueError(
            f"refusing to bundle symlinked staging entry {rel!r}: a symlink "
            "would inline an arbitrary file into the signed bundle"
        )


def _read_bundle_files(staging_dir: Path) -> dict[str, bytes]:
    """Read every bundle file into ``{relpath: bytes}`` (vector/ recursed).

    Every entry — the fixed top-level files AND each file under ``vector/`` — is
    checked with ``is_symlink()`` before it is read, so a planted symlink can never
    inline an arbitrary host file into the signed bundle.
    """
    files: dict[str, bytes] = {}
    for name in ("products.jsonl", _META_NAME, _RANKING_NAME, _COOCCURRENCE_NAME):
        path = staging_dir / name
        _refuse_symlink(path, staging_dir)
        files[name] = path.read_bytes()
    for path in sorted((staging_dir / "vector").rglob("*")):
        _refuse_symlink(path, staging_dir)
        if path.is_file():
            files[path.relative_to(staging_dir).as_posix()] = path.read_bytes()
    return files
