"""Parse and validate catalog manifests."""
from __future__ import annotations

import hashlib
import json
from pathlib import Path

from .models import CatalogManifest


def parse_manifest(path: Path) -> CatalogManifest:
    data = json.loads(path.read_text(encoding="utf-8"))
    return CatalogManifest.model_validate(data)


def validate_checksum(file_path: Path, expected: str) -> bool:
    if not expected.startswith("sha256:"):
        return False
    expected_hash = expected[7:]
    actual_hash = hashlib.sha256(file_path.read_bytes()).hexdigest()
    return actual_hash == expected_hash
