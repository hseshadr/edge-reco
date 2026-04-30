import numpy as np

from edgereco.catalog.models import Product
from edgereco.embeddings.encoder import ProductEncoder


def _make_product(title: str, category: str = "Electronics") -> Product:
    return Product(id="test", title=title, category=category)


def test_encode_single_product() -> None:
    encoder = ProductEncoder()
    products = [_make_product("Wireless Bluetooth Headphones")]
    embeddings = encoder.encode(products)
    assert isinstance(embeddings, np.ndarray)
    assert embeddings.shape == (1, 384)
    assert embeddings.dtype == np.float32


def test_encode_multiple_products() -> None:
    encoder = ProductEncoder()
    products = [
        _make_product("Wireless Headphones"),
        _make_product("Running Shoes", "Clothing"),
        _make_product("Python Book", "Books"),
    ]
    embeddings = encoder.encode(products)
    assert embeddings.shape == (3, 384)


def test_encode_query() -> None:
    encoder = ProductEncoder()
    embedding = encoder.encode_query("wireless headphones")
    assert isinstance(embedding, np.ndarray)
    assert embedding.shape == (384,)


def test_similar_products_have_higher_cosine_similarity() -> None:
    encoder = ProductEncoder()
    query = encoder.encode_query("bluetooth headphones")
    products = [
        _make_product("Wireless Bluetooth Headphones"),
        _make_product("Organic Dog Food", "Home & Kitchen"),
    ]
    embeddings = encoder.encode(products)
    q_norm = np.linalg.norm(query)
    sim_headphones = float(
        np.dot(query, embeddings[0]) / (q_norm * np.linalg.norm(embeddings[0]))
    )
    sim_dogfood = float(
        np.dot(query, embeddings[1]) / (q_norm * np.linalg.norm(embeddings[1]))
    )
    assert sim_headphones > sim_dogfood
