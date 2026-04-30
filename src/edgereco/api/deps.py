"""FastAPI dependency injection: ServiceContainer + get_container()."""
from __future__ import annotations

from dataclasses import dataclass, field

from fastapi import Request

from edgereco.api.sessions import SessionStore
from edgereco.catalog.models import CatalogManifest, Product
from edgereco.embeddings.encoder import ProductEncoder
from edgereco.embeddings.index import VectorIndex
from edgereco.search.keyword import KeywordSearcher
from edgereco.search.vector import VectorSearcher
from edgereco.telemetry.buffer import EventBuffer


@dataclass
class ServiceContainer:
    catalog: list[Product]
    by_id: dict[str, Product]
    keyword: KeywordSearcher
    vector: VectorSearcher
    encoder: ProductEncoder
    sessions: SessionStore = field(default_factory=SessionStore)
    events: EventBuffer = field(default_factory=EventBuffer)
    manifest: CatalogManifest | None = None

    @classmethod
    def from_catalog(
        cls,
        products: list[Product],
        *,
        manifest: CatalogManifest | None = None,
    ) -> ServiceContainer:
        encoder = ProductEncoder()
        embeddings = encoder.encode(products)
        ids = [p.id for p in products]
        index = VectorIndex.build(embeddings, ids, dim=encoder.dim)
        keyword = KeywordSearcher.build(products)
        vector = VectorSearcher(index)
        by_id = {p.id: p for p in products}
        return cls(
            catalog=products,
            by_id=by_id,
            keyword=keyword,
            vector=vector,
            encoder=encoder,
            manifest=manifest,
        )


def get_container(request: Request) -> ServiceContainer:
    return request.app.state.container  # type: ignore[no-any-return]
