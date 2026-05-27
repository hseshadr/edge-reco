"""Parse catalog manifests.

Integrity is no longer checked here — the content-addressed store (edge-proc CAS)
verifies every chunk on read, so the old ``validate_checksum`` flat-file path is
gone. ``CatalogManifest`` survives as the read-model ``/catalog/info`` exposes.
"""

from __future__ import annotations

import json
from pathlib import Path

from .models import CatalogManifest


def parse_manifest(path: Path) -> CatalogManifest:
    data = json.loads(path.read_text(encoding="utf-8"))
    return CatalogManifest.model_validate(data)
