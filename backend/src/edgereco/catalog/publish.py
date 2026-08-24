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
- ``ranking_receipt.json`` — EdgeReco's static ``edgereco.ranking-proof/v1``:
  the complete staged-config hash plus Assay formula probes for search and every
  strategy, sealed with Avow under the same publisher key as the bundle. It never
  contains personalized results. Regenerated every publish; legacy receipts are
  reported unavailable by v1 consumers.
- ``cooccurrence.json`` — the item-to-item co-occurrence neighbour map
  (``reco.cooccurrence``). Co-occurrence strategies read it; absent, the producer
  writes an empty matrix so older bundles degrade gracefully.

edge-proc stays generic (opaque files only); this module owns the domain shape.
"""

from __future__ import annotations

import errno
import os
from pathlib import Path
from typing import Final

from edgeproc.bundles.cas import FilesystemCacheStore
from edgeproc.bundles.chunking import GearCDC
from edgeproc.bundles.publish import build_bundle
from edgeproc.bundles.signing import Ed25519Signer
from pydantic import BaseModel

from edgereco.catalog.product_image import ImageMode, localize_catalog
from edgereco.reco.cooccurrence import CooccurrenceMatrix
from edgereco.reco.ranking_config import DEFAULT_RANKING_CONFIG, RankingConfig
from edgereco.reco.score_receipt import (
    RANKING_RECEIPT_NAME,
    sign_ranking_receipt,
    signing_key_from_seed,
)

# Logical top-level entries a bundle staging dir must provide; ``vector`` is a dir.
BUNDLE_FILES: Final[tuple[str, ...]] = (
    "products.jsonl",
    "vector",
    "catalog_meta.json",
    "ranking_config.json",
    "ranking_receipt.json",
    "cooccurrence.json",
    "images",
)
#: Raster extensions a staged REAL photo may carry (mirrors ``image_download``).
#: ``svg`` is deliberately absent — that is the generated placeholder, not a photo.
_PHOTO_EXTENSIONS: Final[frozenset[str]] = frozenset({"jpg", "png", "webp"})
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
    sequence: int = 1,
    image_mode: ImageMode = ImageMode.LOCAL,
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
    _write_json_no_follow(staging_dir / _META_NAME, meta.model_dump_json())
    _localize_product_images(staging_dir, image_mode)
    _ensure_ranking_config(staging_dir, require_present=require_feature_files)
    _ensure_cooccurrence(staging_dir, require_present=require_feature_files)
    _write_ranking_receipt(staging_dir, private_key_path)
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
        bind_identity=True,
        channel="stable",
        sequence=sequence,
    )


def _ensure_ranking_config(staging_dir: Path, *, require_present: bool = False) -> None:
    """Materialize one canonical typed ``ranking_config.json``.

    Existing config is validated then rewritten from Pydantic so the signed bytes,
    proof hash, and browser all consume the same default-expanded, extra-free shape.
    A fresh build gets ``DEFAULT_RANKING_CONFIG``. A missing required file fails.
    """
    ranking_path = staging_dir / _RANKING_NAME
    if ranking_path.exists():
        config = RankingConfig.model_validate_json(ranking_path.read_bytes())
        _write_json_no_follow(ranking_path, config.model_dump_json())
        return
    if require_present:
        raise FileNotFoundError(
            f"{ranking_path} missing from a current-schema bundle; refusing to "
            "silently republish with legacy default weights"
        )
    _write_json_no_follow(ranking_path, DEFAULT_RANKING_CONFIG.model_dump_json())


def _write_ranking_receipt(staging_dir: Path, private_key_path: Path) -> None:
    """Seal the static STAGED ranking proof — regenerated every publish.

    A derived artifact like ``catalog_meta.json``: always rewritten from the staged
    ``ranking_config.json`` plus the publisher key (the same raw Ed25519 seed that
    signs the bundle), never carried over from a synced bundle. The payload binds the
    complete config and deterministic formula probes, never a shopper-specific score.
    """
    config = RankingConfig.model_validate_json((staging_dir / _RANKING_NAME).read_bytes())
    receipt = sign_ranking_receipt(config, signing_key_from_seed(private_key_path))
    _write_json_no_follow(staging_dir / RANKING_RECEIPT_NAME, receipt.model_dump_json())


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
    _write_json_no_follow(cooc_path, CooccurrenceMatrix().model_dump_json())


def _localize_product_images(staging_dir: Path, image_mode: ImageMode) -> None:
    """Bake a local card per product and point every ``image_url`` at it.

    In ``ImageMode.REMOTE`` this is a no-op: the catalog keeps its own CDN urls and the
    deployment is responsible for listing those hosts in ``img-src``.

    The storefront renders an ``<img>`` only for a root-relative, same-origin url
    (``ProductImage.isLocalImage``) and production ships ``img-src 'self' data:``, so
    a bundle carrying third-party CDN urls shows NO product image — and would leak
    every visitor's IP to that CDN if it did. Localizing here, in the producer, means
    every publisher gets a catalog whose urls are servable and cards that are inside
    the signature, not just the demo rebuild script.

    SCOPE: this guarantees the cards EXIST and are signed. Serving them is still the
    deployer's step — the SPA fetches ``/images/<id>.svg`` from the static origin, and
    only ``scripts/rebuild_example_bundle.py`` currently mirrors them there (into
    ``frontend/app/public/images``). A third-party publisher must copy the bundle's
    ``images/`` to its own static root.

    Idempotent: the url is derived from the product id, and the renderer is
    deterministic, so republishing an already-localized catalog is a no-op bytewise.

    Note the ``images`` DIR is symlink-checked as well as each card. ``O_NOFOLLOW``
    only guards the FINAL path component, and ``mkdir(exist_ok=True)`` accepts a
    symlink that already points at a directory — so without this check a planted
    ``images -> /somewhere`` would redirect every card write out of the staging tree.
    """
    products_path = staging_dir / "products.jsonl"
    _refuse_symlink(products_path, staging_dir)
    images_dir = staging_dir / "images"
    _refuse_symlink(images_dir, staging_dir)
    if image_mode is ImageMode.REMOTE:
        return  # nothing to write: the catalog's own urls ARE the contract here
    rewritten, cards = localize_catalog(
        products_path.read_text(encoding="utf-8"), _staged_photos(images_dir), image_mode
    )
    _write_json_no_follow(products_path, rewritten)
    images_dir.mkdir(exist_ok=True)
    for relpath, svg in cards.items():
        _write_bytes_no_follow(staging_dir / relpath, svg)


def _staged_photos(images_dir: Path) -> dict[str, str]:
    """Map product id -> extension for every REAL photo the build already localized.

    A staged ``<id>.jpg`` means the download step succeeded for that product, so the
    producer points its url there and leaves the bytes alone. ``.svg`` is skipped: it
    is the placeholder this function's caller regenerates, never a real photo.
    """
    if not images_dir.is_dir():
        return {}
    return {
        path.stem: path.suffix.lstrip(".").lower()
        for path in sorted(images_dir.iterdir())
        if _is_staged_photo(path)
    }


def _is_staged_photo(path: Path) -> bool:
    """A real, non-symlinked photo file the download step left for the producer."""
    return (
        path.is_file()
        and not path.is_symlink()
        and path.suffix.lstrip(".").lower() in _PHOTO_EXTENSIONS
    )


def _open_no_follow(path: Path) -> int:
    """Open ``path`` for writing, refusing to follow a symlink at the final component.

    The producer unconditionally (re)writes its staging files — ``catalog_meta.json``
    every publish, plus ``ranking_config.json`` / ``cooccurrence.json`` when defaulting
    and the localized ``products.jsonl`` / ``images/*.svg``. Plain ``Path.write_text``
    FOLLOWS a pre-planted symlink at that path and would clobber whatever it targets: an
    arbitrary host-file WRITE-through (the mirror of the read-side guard below).
    ``O_NOFOLLOW`` makes ``os.open`` fail with ``ELOOP`` on a symlink, so the write can
    never be redirected; fail closed with a clear ``ValueError``. A real file at the same
    path is created/truncated exactly as ``write_text`` would — only a symlink is
    refused. Portable: a platform without the flag yields ``0`` (a no-op bit).
    """
    flags = os.O_WRONLY | os.O_CREAT | os.O_TRUNC | getattr(os, "O_NOFOLLOW", 0)
    try:
        return os.open(path, flags, 0o644)
    except OSError as exc:
        if exc.errno == errno.ELOOP:
            raise ValueError(
                f"refusing to write staging file {path.name!r} through a symlink: a "
                "planted symlink would redirect the producer's write to an arbitrary file"
            ) from exc
        raise


def _write_json_no_follow(path: Path, payload: str) -> None:
    """Write text to ``path`` through the symlink-refusing open."""
    with os.fdopen(_open_no_follow(path), "w", encoding="utf-8") as handle:
        handle.write(payload)


def _write_bytes_no_follow(path: Path, payload: bytes) -> None:
    """Write bytes to ``path`` through the symlink-refusing open."""
    with os.fdopen(_open_no_follow(path), "wb") as handle:
        handle.write(payload)


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
    """Read every bundle file into ``{relpath: bytes}`` (``vector/`` + ``images/`` recursed).

    Every entry — the fixed top-level files AND each file under ``vector/`` /
    ``images/`` — is checked with ``is_symlink()`` before it is read, so a planted
    symlink can never inline an arbitrary host file into the signed bundle. The
    ``images/`` dir is optional: a staging dir without one (an older catalog, or a
    republish that predates baked-in cards) simply signs no image entries.
    """
    files: dict[str, bytes] = {}
    for name in (
        "products.jsonl",
        _META_NAME,
        _RANKING_NAME,
        RANKING_RECEIPT_NAME,
        _COOCCURRENCE_NAME,
    ):
        path = staging_dir / name
        _refuse_symlink(path, staging_dir)
        files[name] = path.read_bytes()
    _read_tree(staging_dir, "vector", files)
    _read_tree(staging_dir, "images", files, skip_extensions=_PHOTO_EXTENSIONS)
    return files


def _read_tree(
    staging_dir: Path,
    subdir: str,
    files: dict[str, bytes],
    *,
    skip_extensions: frozenset[str] = frozenset(),
) -> None:
    """Read every file under ``staging_dir/subdir`` into ``files`` (symlink-refused).

    ``skip_extensions`` keeps DOWNLOADED PRODUCT PHOTOS out of the signed set. They are
    an ORIGIN asset, not bundle payload: `syncIndex` reassembles and hash-verifies every
    file in the manifest on every sync, so signing ~16 MB of photos would make each
    visitor download and verify bytes no client ever reads back — the SPA loads
    ``/images/<id>`` as ordinary static assets, lazily, from the same origin. Excluding
    them keeps the bundle ~4.6 MB and the "one small signed file" promise intact.
    """
    for path in sorted((staging_dir / subdir).rglob("*")):
        _refuse_symlink(path, staging_dir)
        if path.is_file() and path.suffix.lstrip(".").lower() not in skip_extensions:
            files[path.relative_to(staging_dir).as_posix()] = path.read_bytes()
