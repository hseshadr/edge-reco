"""Catalog info endpoint."""

from __future__ import annotations

from fastapi import APIRouter

from edgereco.api.deps import Container
from edgereco.api.models import CatalogInfo, IndexStats

router = APIRouter()


@router.get("/catalog/info", response_model=CatalogInfo)
def catalog_info(container: Container) -> CatalogInfo:
    manifest = container.manifest
    catalog_id = manifest.catalog_id if manifest else "in-memory"
    version = manifest.version if manifest else "0.0.0"
    return CatalogInfo(
        catalog_id=catalog_id,
        version=version,
        product_count=len(container.catalog),
        index_stats=IndexStats(
            keyword_corpus_size=len(container.catalog),
            vector_index_size=container.vector.ntotal,
        ),
    )
