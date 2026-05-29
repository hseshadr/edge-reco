"""FastAPI dependency injection: ServiceContainer + get_container()."""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Annotated

from edgeproc.bundles.adapters import FetchAdapter, FilesystemAdapter, HttpAdapter
from edgeproc.bundles.cas import FilesystemCacheStore
from edgeproc.bundles.manifest import IndexManifest
from edgeproc.bundles.signing import Verifier
from edgeproc.bundles.sync import materialize_file, sync_index
from fastapi import Depends, Header, Request

from edgereco.api.sessions import SessionStore
from edgereco.catalog.models import CatalogManifest, Product
from edgereco.catalog.publish import CatalogMeta
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

    @classmethod
    def from_synced(
        cls,
        *,
        base_url: str,
        cache_root: Path,
        verifier: Verifier,
    ) -> ServiceContainer:
        """Build a container from a signed, content-addressed bundle origin.

        Sync the bundle (fail-closed on a bad signature / tampered chunk), reassemble
        each bundled file into a local dir, ``VectorIndex.load`` the prebuilt ``vector/``
        (zero recompute on the edge), and parse ``catalog_meta.json`` into a
        ``CatalogManifest`` so ``/catalog/info`` keeps working unchanged.
        """
        from edgereco.catalog.loader import load_jsonl

        store, manifest = _sync_and_load_manifest(
            base_url=base_url, cache_root=cache_root, verifier=verifier
        )
        local = _materialize_bundle(store, manifest, cache_root / "materialized")
        catalog = load_jsonl(local / "products.jsonl")
        meta = CatalogMeta.model_validate_json((local / "catalog_meta.json").read_bytes())
        vector = VectorSearcher(VectorIndex.load(local / "vector"))
        return cls(
            catalog=catalog,
            by_id={p.id: p for p in catalog},
            keyword=KeywordSearcher.build(catalog),
            vector=vector,
            encoder=ProductEncoder(),
            manifest=_manifest_from_meta(meta),
        )


def _sync_and_load_manifest(
    *, base_url: str, cache_root: Path, verifier: Verifier
) -> tuple[FilesystemCacheStore, IndexManifest]:
    """Sync the origin into a fresh store, then load + validate the active manifest."""
    store = FilesystemCacheStore(cache_root)
    sync_index(base_url=base_url, store=store, adapter=_select_adapter(base_url), verifier=verifier)
    pointer = store.read_active()
    if pointer is None:  # pragma: no cover - sync_index promotes or raises
        raise RuntimeError("sync completed without promoting an active version")
    return store, IndexManifest.model_validate_json(store.get_manifest(pointer.manifest_hash))


def _materialize_bundle(store: FilesystemCacheStore, manifest: IndexManifest, dest: Path) -> Path:
    """Reassemble every bundled file (vector/ subdir preserved) into ``dest``."""
    for entry in manifest.files:
        out = dest / entry.path
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_bytes(materialize_file(store, manifest, entry.path))
    return dest


def _select_adapter(base_url: str) -> FetchAdapter:
    """HTTP adapter for an http(s) origin, filesystem adapter for a local path."""
    if base_url.startswith(("http://", "https://")):
        return HttpAdapter()
    return FilesystemAdapter()


def _manifest_from_meta(meta: CatalogMeta) -> CatalogManifest:
    """Project bundle ``catalog_meta.json`` onto the legacy ``CatalogManifest`` view."""
    return CatalogManifest(
        catalog_id=meta.catalog_id,
        version=meta.version,
        embedding_model=meta.embedding_model,
        embedding_dim=meta.embedding_dim,
        files=[],
    )


def get_container(request: Request) -> ServiceContainer:
    container = request.app.state.container
    if not isinstance(container, ServiceContainer):
        msg = "app.state.container is not a ServiceContainer; app was not initialized"
        raise RuntimeError(msg)
    return container


def get_session_id(x_session_id: Annotated[str | None, Header()] = None) -> str:
    """FastAPI dependency: return X-Session-Id header value or generate a new UUID."""
    return x_session_id if x_session_id else str(uuid.uuid4())


Container = Annotated[ServiceContainer, Depends(get_container)]
