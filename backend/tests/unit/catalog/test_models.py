from edgereco.catalog.models import (
    CatalogFile,
    CatalogManifest,
    InteractionEvent,
    Product,
    SessionProfile,
)


def test_product_from_dict() -> None:
    data = {"id": "B001", "title": "Test", "category": "Electronics", "price": 9.99}
    product = Product.model_validate(data)
    assert product.id == "B001"
    assert product.popularity_score == 0.0
    assert product.tags == []


def test_product_full_fields() -> None:
    product = Product(
        id="B001",
        title="Test",
        category="Electronics",
        tags=["wireless"],
        brand="Sony",
        price=99.99,
        popularity_score=0.85,
        freshness_score=0.6,
    )
    assert product.brand == "Sony"
    assert len(product.tags) == 1


def test_catalog_manifest() -> None:
    manifest = CatalogManifest(
        catalog_id="test",
        version="2026-01-01T00:00:00Z",
        embedding_model="all-MiniLM-L6-v2",
        embedding_dim=384,
        files=[CatalogFile(path="products.jsonl", file_type="products", checksum="sha256:abc")],
    )
    assert manifest.catalog_id == "test"
    assert len(manifest.files) == 1


def test_session_profile_defaults() -> None:
    profile = SessionProfile()
    assert profile.category_affinity == {}
    assert profile.click_count == 0
    assert profile.recently_viewed == []


def test_interaction_event_metadata_is_not_shared_between_instances() -> None:
    # Each event must own its own metadata dict — mutating one never leaks into another.
    first = InteractionEvent(event_type="click", product_id="p1", timestamp="t")
    second = InteractionEvent(event_type="view", product_id="p2", timestamp="t")
    first.metadata["k"] = "v"
    assert second.metadata == {}
    assert first.metadata is not second.metadata
