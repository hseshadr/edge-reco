"""FastAPI dependency injection: ServiceContainer + get_container()."""
from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Annotated

from fastapi import Depends, Header, Request

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

    @classmethod
    def from_dirs(cls, cache_dir: Path, index_dir: Path) -> ServiceContainer:
        """Build a container from a synced cache dir and a pre-built index dir."""
        from edgereco.catalog.loader import load_jsonl
        from edgereco.catalog.manifest import parse_manifest

        catalog = load_jsonl(cache_dir / "products.jsonl")
        manifest = parse_manifest(cache_dir / "manifest.json")
        encoder = ProductEncoder()
        vector_index = VectorIndex.load(index_dir / "vector")
        keyword = KeywordSearcher.build(catalog)
        vector = VectorSearcher(vector_index)
        by_id = {p.id: p for p in catalog}
        return cls(
            catalog=catalog,
            by_id=by_id,
            keyword=keyword,
            vector=vector,
            encoder=encoder,
            manifest=manifest,
        )


def get_container(request: Request) -> ServiceContainer:
    return request.app.state.container  # type: ignore[no-any-return]


def get_session_id(x_session_id: Annotated[str | None, Header()] = None) -> str:
    """FastAPI dependency: return X-Session-Id header value or generate a new UUID."""
    return x_session_id if x_session_id else str(uuid.uuid4())


Container = Annotated[ServiceContainer, Depends(get_container)]
