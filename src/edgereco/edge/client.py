"""Edge catalog client protocol."""

from __future__ import annotations

from pathlib import Path
from typing import Protocol

from edgereco.catalog.models import CatalogManifest


class EdgeCatalogClient(Protocol):
    def fetch_manifest(self, base_url: str) -> CatalogManifest: ...
    def fetch_file(self, base_url: str, path: str, local_path: Path) -> None: ...
