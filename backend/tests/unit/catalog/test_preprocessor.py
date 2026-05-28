from edgereco.catalog.preprocessor import amazon_row_to_product, normalize_score


def test_normalize_score_range() -> None:
    values = [0, 1, 5, 10, 100]
    normalized = [normalize_score(v, min_val=0, max_val=100) for v in values]
    assert all(0 <= n <= 1 for n in normalized)
    assert normalized[0] == 0.0
    assert normalized[-1] == 1.0


def test_normalize_score_single_value() -> None:
    assert normalize_score(5, min_val=5, max_val=5) == 0.0


def test_amazon_row_to_product() -> None:
    row = {
        "asin": "B0TEST",
        "title": "Test Product",
        "stars": 4.5,
        "reviews": 1000,
        "price": 29.99,
        "listPrice": 39.99,
        "category_id": "Electronics > Audio > Headphones",
        "isBestSeller": True,
        "boughtInLastMonth": 500,
        "imgUrl": "https://example.com/img.jpg",
        "productURL": "https://amazon.com/dp/B0TEST",
    }
    product = amazon_row_to_product(row, pop_min=0, pop_max=10, fresh_min=0, fresh_max=1000)
    assert product.id == "B0TEST"
    assert product.category == "Electronics"
    assert "Audio" in product.subcategories
    assert product.price == 29.99
    assert 0 <= product.popularity_score <= 1
    assert 0 <= product.freshness_score <= 1
