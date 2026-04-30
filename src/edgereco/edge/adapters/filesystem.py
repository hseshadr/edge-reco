"""Filesystem catalog adapter for testing and local development."""
from __future__ import annotations

import json
import shutil
from pathlib import Path

from edgereco.catalog.models import CatalogManifest


class FilesystemAdapter:
    def fetch_manifest(self, base_url: str) -> CatalogManifest:
        data = json.loads(Path(base_url).read_text(encoding="utf-8"))
        return CatalogManifest.model_validate(data)

    def fetch_file(self, base_url: str, path: str, local_path: Path) -> None:
        source = Path(base_url) / path
        local_path.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, local_path)
