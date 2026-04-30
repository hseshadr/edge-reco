"""Catalog synchronization from an edge server."""

from __future__ import annotations

from pathlib import Path

import structlog

from edgereco.catalog.manifest import validate_checksum
from edgereco.catalog.models import CatalogManifest
from edgereco.edge.client import EdgeCatalogClient

log = structlog.get_logger(__name__)


def sync_catalog(
    *,
    manifest_url: str,
    cache_dir: Path,
    client: EdgeCatalogClient,
    file_base_url: str,
) -> CatalogManifest:
    """Sync a catalog from an edge server to a local cache directory.

    Downloads all files listed in the manifest and validates checksums.
    """
    cache_dir.mkdir(parents=True, exist_ok=True)

    log.info("fetching manifest", url=manifest_url)
    manifest = client.fetch_manifest(manifest_url)

    for file_entry in manifest.files:
        local_path = cache_dir / file_entry.path
        log.info("downloading", path=file_entry.path, local=str(local_path))
        client.fetch_file(file_base_url, file_entry.path, local_path)

        if not validate_checksum(local_path, file_entry.checksum):
            msg = f"checksum validation failed for {file_entry.path}"
            raise ValueError(msg)

    (cache_dir / "manifest.json").write_text(manifest.model_dump_json(indent=2))
    log.info("sync complete", catalog_id=manifest.catalog_id, version=manifest.version)
    return manifest
