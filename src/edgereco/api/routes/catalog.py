"""Catalog info endpoint."""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter

from edgereco.api.deps import Container

router = APIRouter()


@router.get("/catalog/info")
def catalog_info(container: Container) -> dict[str, Any]:
    manifest = container.manifest
    catalog_id = manifest.catalog_id if manifest else "in-memory"
    version = manifest.version if manifest else "0.0.0"
    return {
        "catalog_id": catalog_id,
        "version": version,
        "product_count": len(container.catalog),
        "index_stats": {
            "keyword_corpus_size": len(container.catalog),
            "vector_index_size": container.vector.ntotal,
        },
    }
